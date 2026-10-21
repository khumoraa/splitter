import React, { memo, useCallback, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FileText, Share2 } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError, logLevelForError } from '@/shared/api/api-error';
import { radius, space } from '@/shared/ui/tokens';
import { GlassSurface } from '@/shared/ui/GlassSurface';
import { Banner, Button, Card, Skeleton } from '@/features/profile/ui/kit';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { PillButton } from '@/features/social/ui/parts';
import { useOnline } from '@/features/social/lib/use-online';
import { useNotice } from '@/features/social/lib/use-notice';
import { formatMinor } from '@/features/scan/lib/receipt-calc';
import { PaymentsApi, type Ledger, type Obligation } from '../api/payments.api';
import { allowedActions, deriveStatus, type Action } from '../lib/rules';
import { eventKey, obligationLook } from '../lib/status-ui';
import { paymentErrorKey } from '../lib/errors';
import { billStatementModel } from '../lib/statement-model';
import { sharePdf, shareText } from '../lib/export';
import { useLedger } from '../lib/use-ledger';
import { StatusBadge } from './StatusBadge';

type Fmt = (minor: number) => string;

const ObligationRow = memo(function ObligationRow({ o, fmt, busy, online, onAction, onConfirm }: {
  o: Obligation; fmt: Fmt; busy: boolean; online: boolean;
  onAction: (o: Obligation, a: Action, paymentId?: number) => void;
  onConfirm: (o: Obligation, paymentId: number) => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const pending = o.payments.filter((p) => p.status === 'PENDING');
  const actions = allowedActions(o.myRole, o.status, pending.length > 0, o);
  const me = o.myRole === 'debtor' ? 'debtor' : o.myRole === 'creditor' ? 'creditor' : null;
  const who = me === 'debtor' ? t('payments.row.youOwe', { name: o.creditor.username }) : me === 'creditor' ? t('payments.row.owesYou', { name: o.debtor.username }) : t('payments.row.owes', { from: o.debtor.username, to: o.creditor.username });
  const look = obligationLook(o.status);
  return (
    <View style={{ gap: space.sm, paddingVertical: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <ProfileAvatar uri={(me === 'debtor' ? o.creditor : o.debtor).avatarUrl} name={(me === 'debtor' ? o.creditor : o.debtor).username} seed={(me === 'debtor' ? o.creditor : o.debtor).uniqueId} size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{who}</Text>
          <StatusBadge look={look} compact />
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit style={{ color: c.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmt(o.amountMinor)}</Text>
          {o.outstandingMinor > 0 && o.outstandingMinor !== o.amountMinor && (
            <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 12 }}>{t('payments.row.left', { amount: fmt(o.outstandingMinor) })}</Text>
          )}
        </View>
      </View>

      {o.payments.map((p) => (
        <View key={p.id} style={{ marginLeft: 52, padding: space.sm, borderRadius: radius.field, backgroundColor: c.field, gap: 4 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: p.status === 'REJECTED' ? c.textMuted : c.text, fontSize: 14 }}>
            {t(`payments.payment.${p.status}`, { name: p.recordedBy.username, amount: fmt(p.amountMinor), method: t(`payments.method.${p.method}`) })}
          </Text>
          {!!p.note && <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>“{p.note}”</Text>}
          {p.status === 'REJECTED' && !!p.rejectionReason && <Text maxFontSizeMultiplier={1.4} style={{ color: c.danger, fontSize: 13 }}>{t('payments.payment.reason', { reason: p.rejectionReason })}</Text>}
          {p.status === 'PENDING' && actions.includes('confirm') && (
            <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' }}>
              <PillButton kind="secondary" title={t('payments.action.reject')} disabled={busy || !online} onPress={() => onAction(o, 'reject', p.id)} />
              <PillButton title={t('payments.action.confirm')} loading={busy} disabled={!online} onPress={() => onConfirm(o, p.id)} />
            </View>
          )}
        </View>
      ))}

      {actions.some((a) => a !== 'confirm' && a !== 'reject') && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'flex-end' }}>
          {actions.includes('remind') && <PillButton kind="secondary" title={t('payments.action.remind')} disabled={busy || !online} onPress={() => onAction(o, 'remind')} />}
          {actions.includes('forgive') && <PillButton kind="secondary" title={t('payments.action.forgive')} disabled={busy || !online} onPress={() => onAction(o, 'forgive')} />}
          {actions.includes('recordReceived') && <PillButton title={t('payments.action.received')} disabled={busy || !online} onPress={() => onAction(o, 'recordReceived')} />}
          {actions.includes('markPaid') && <PillButton title={t('payments.action.iPaid')} disabled={busy || !online} onPress={() => onAction(o, 'markPaid')} />}
        </View>
      )}
    </View>
  );
});

function Timeline({ ledger, fmt, locale }: { ledger: Ledger; fmt: Fmt; locale: string }) {
  const c = useColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const events = [...ledger.events].reverse();
  const shown = open ? events : events.slice(0, 3);
  const debtorOf = (oid: number) => ledger.obligations.find((o) => o.id === oid)?.debtor.username ?? '';
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {t('payments.timeline.title')}
      </Text>
      {shown.map((e, i) => (
        <View key={e.id} style={{ flexDirection: 'row', gap: space.md }} accessible>
          <View style={{ alignItems: 'center', width: 12 }} importantForAccessibility="no-hide-descendants">
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: e.type === 'PAYMENT_REJECTED' ? c.danger : e.type.startsWith('PAYMENT') || e.type === 'FORGIVEN' ? c.accentText : c.border }} />
            {i < shown.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: c.border }} />}
          </View>
          <View style={{ flex: 1, paddingBottom: space.sm }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14 }}>
              {t(eventKey(e.type), { name: e.actor.username, amount: e.amountMinor !== null ? fmt(e.amountMinor) : '', debtor: debtorOf(e.obligationId) })}
            </Text>
            {!!e.note && <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>“{e.note}”</Text>}
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 12 }}>{new Date(e.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
        </View>
      ))}
      {events.length > 3 && <PillButton kind="secondary" title={open ? t('payments.timeline.less') : t('payments.timeline.all', { count: events.length })} onPress={() => setOpen((v) => !v)} />}
    </View>
  );
}

/**
 * "Settlement" of one bill: who owes whom, status of every debt (icon + text), actions by role, the event log,
 * and sharing / PDF export. Splitter only records settlements made outside the app.
 */
export function SettlementBlock({ sessionId }: { sessionId: number | undefined }) {
  const c = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const locale = useAppStore((s) => s.language) || 'en';
  const online = useOnline();
  const { data, setData, errorKey, reload } = useLedger(sessionId);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [notice, notify] = useNotice(6000);
  const [exporting, setExporting] = useState(false);

  const currency = data?.totals.currency ?? data?.session.currency ?? 'USD';
  const fmt = useCallback((m: number) => formatMinor(m, currency, locale), [currency, locale]);
  const errText = (e: unknown) => t(paymentErrorKey(isApiError(e) ? e : {}));

  const onConfirm = useCallback((o: Obligation, paymentId: number) => {
    const p = o.payments.find((x) => x.id === paymentId);
    if (!p || !data) return;
    Alert.alert(t('payments.confirm.title'), t('payments.confirm.message', { amount: fmt(p.amountMinor), name: o.debtor.username }), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      {
        text: t('payments.action.confirm'),
        onPress: async () => {
          if (busy[o.id]) return;
          const before = data;
          // optimistic: the mark becomes money received at once, rolled back if the server says no
          const amounts = { amountMinor: o.amountMinor, confirmedMinor: o.confirmedMinor + p.amountMinor, pendingMinor: o.pendingMinor - p.amountMinor };
          setData({ ...before, obligations: before.obligations.map((x) => (x.id === o.id ? { ...x, ...amounts, outstandingMinor: Math.max(0, x.amountMinor - amounts.confirmedMinor), status: deriveStatus(amounts), payments: x.payments.map((y) => (y.id === p.id ? { ...y, status: 'CONFIRMED' as const } : y)) } : x)) });
          setBusy((b) => ({ ...b, [o.id]: true }));
          try {
            await PaymentsApi.confirm(o.id, paymentId);
            haptics.success();
            notify({ kind: 'success', text: t('payments.done.confirmed') });
          } catch (e) {
            setData(before);
            haptics.error();
            console[logLevelForError(e)]('confirm payment failed');
            notify({ kind: 'error', text: errText(e) });
          } finally {
            setBusy((b) => ({ ...b, [o.id]: false }));
            void reload();
          }
        },
      },
    ]);
  }, [data, busy, fmt, notify, reload, setData, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const remind = async (o: Obligation) => {
    const message = t('payments.remind.message', { name: o.debtor.username, amount: fmt(o.outstandingMinor), bill: data?.session.name || t('payments.statement.untitled'), payer: o.creditor.username });
    try {
      const r = await Share.share({ message });
      if (r.action !== Share.sharedAction) return;
      await PaymentsApi.remind(o.id);
      haptics.success();
      void reload();
    } catch (e) {
      if (isApiError(e) && e.code === 'REMINDER_TOO_SOON') notify({ kind: 'info', text: t('payments.errors.REMINDER_TOO_SOON') });
      else if (isApiError(e)) notify({ kind: 'error', text: errText(e) });
    }
  };

  const onAction = useCallback((o: Obligation, a: Action, paymentId?: number) => {
    if (a === 'remind') return void remind(o);
    const mode = a === 'markPaid' ? 'mark' : a === 'recordReceived' ? 'record' : a === 'reject' ? 'reject' : 'forgive';
    router.push({ pathname: '/tabs/payment-sheet', params: { sessionId: String(o.sessionId), obligationId: String(o.id), mode, ...(paymentId ? { paymentId: String(paymentId) } : {}) } } as never);
  }, [router, data, fmt]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportPdf = async (asPdf: boolean) => {
    if (!sessionId || exporting) return;
    setExporting(true);
    try {
      const st = await PaymentsApi.billStatement(sessionId);
      const model = billStatementModel(st, (k, o) => t(k, o), (m) => formatMinor(m, st.currency ?? currency, locale), (iso) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }));
      if (asPdf) await sharePdf(model, model.title); else await shareText(model);
      haptics.success();
    } catch (e) {
      console[logLevelForError(e)]('statement export failed');
      notify({ kind: 'error', text: isApiError(e) ? errText(e) : t('payments.errors.export') });
    } finally {
      setExporting(false);
    }
  };

  if (!sessionId) return null;
  if (!data) {
    return errorKey ? (
      <Card style={{ gap: space.md }}>
        <Text style={{ color: c.text, fontSize: 15 }}>{t(errorKey)}</Text>
        {errorKey !== 'payments.errors.noAccess' && <Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void reload()} />}
      </Card>
    ) : (
      <View style={{ gap: space.sm }} accessibilityLabel={t('common.loading', 'Loading...')}><Skeleton height={28} width="50%" /><Skeleton height={72} /><Skeleton height={72} /></View>
    );
  }

  const tot = data.totals;
  const progress = tot.amountMinor > 0 ? (tot.settledMinor + tot.forgivenMinor) / tot.amountMinor : 1;

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{t('payments.block.title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 14 }}>{t('payments.block.paidBy', { name: data.session.payer.username })}</Text>
        </View>

        {data.obligations.length === 0 ? (
          <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>{t('payments.block.nothing')}</Text>
        ) : (
          <>
            <View accessible accessibilityLabel={t('payments.block.progressA11y', { settled: fmt(tot.settledMinor + tot.forgivenMinor), total: fmt(tot.amountMinor) })} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>{t('payments.block.settled', { amount: fmt(tot.settledMinor + tot.forgivenMinor) })}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>{t('payments.block.outstanding', { amount: fmt(tot.outstandingMinor) })}</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.field, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(Math.min(1, progress) * 100)}%`, height: 8, backgroundColor: c.accentFill }} />
              </View>
            </View>
            {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}
            {!online && <Text style={{ color: c.textMuted, fontSize: 13 }}>{t('social.offlineActions', "You're offline: actions are disabled.")}</Text>}
            {data.obligations.map((o, i) => (
              <View key={o.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                <ObligationRow o={o} fmt={fmt} busy={!!busy[o.id]} online={online} onAction={onAction} onConfirm={onConfirm} />
              </View>
            ))}
          </>
        )}
      </Card>

      {data.events.length > 0 && <Card><Timeline ledger={data} fmt={fmt} locale={locale} /></Card>}

      {/* floating-style action bar on glass: one of the few glass elements in the app */}
      <GlassSurface style={{ flexDirection: 'row', gap: space.sm, padding: space.sm }}>
        <View style={{ flex: 1 }}><Button variant="secondary" icon={<Share2 size={18} color={c.text} />} title={t('payments.share.text')} loading={exporting} onPress={() => void exportPdf(false)} /></View>
        <View style={{ flex: 1 }}><Button variant="secondary" icon={<FileText size={18} color={c.text} />} title={t('payments.share.pdf')} loading={exporting} onPress={() => void exportPdf(true)} /></View>
      </GlassSurface>
      <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 11, lineHeight: 15, textAlign: 'center' }}>{t('payments.statement.legal')}</Text>
    </View>
  );
}
