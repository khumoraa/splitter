import React, { useCallback, useRef, useState } from 'react';
import { useLeaveGuard } from '@/shared/lib/navigation/use-leave-guard';
import { Alert, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Camera, Image as ImageIcon, Trash2 } from '@tamagui/lucide-icons';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { useProfileActions } from '@/features/profile/model/use-profile-actions';
import { prepareAvatar } from '@/features/profile/lib/prepare-avatar';
import { validateUsername } from '@/features/profile/lib/validation';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { Banner, Button, Card, Field, FadeIn, PermissionNotice, Row, Screen, Section } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

type Notice = { kind: 'success' | 'error'; text: string } | null;

export default function ProfileEditScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const actions = useProfileActions();
  const nameRef = useRef<TextInput>(null);

  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [photoBlocked, setPhotoBlocked] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [name, setName] = useState(user?.username ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const uploading = progress !== null;
  // unsaved name or a photo still uploading: ask before swiping away
  useLeaveGuard({ dirty: name.trim() !== (user?.username ?? '').trim(), busy: uploading || savingName });
  const cameraBlocked = cameraPermission?.granted === false && cameraPermission.canAskAgain === false;

  const fail = useCallback((key: string) => {
    haptics.error();
    setNotice({ kind: 'error', text: t(key) });
  }, [t]);

  const uploadPicked = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setNotice(null);
    setProgress(0);
    try {
      // convert first (HEIC -> JPEG, square, 512 px); a failure here never touches the current avatar
      const file = await prepareAvatar(asset);
      const result = await actions.setAvatar(file, setProgress);
      if (result.ok) {
        haptics.success();
        setNotice({ kind: 'success', text: t('profile.avatar.updated', 'Photo updated') });
      } else {
        fail(result.key);
      }
    } catch {
      fail('profile.errors.prepareFailed');
    } finally {
      setProgress(null);
    }
  }, [actions, fail, t]);

  const pickFromLibrary = useCallback(async () => {
    if (uploading) return;
    setPhotoBlocked(false);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (!res.canceled && res.assets[0]) await uploadPicked(res.assets[0]);
    } catch (e) {
      // access to the photo library refused (or the picker could not open)
      if (/permission|denied|authori/i.test(String((e as Error)?.message))) setPhotoBlocked(true);
      else fail('errors.unexpected');
    }
  }, [fail, uploadPicked, uploading]);

  const takePhoto = useCallback(async () => {
    if (uploading) return;
    let granted = cameraPermission?.granted ?? false;
    if (!granted) granted = (await requestCameraPermission()).granted;
    if (!granted) return; // the PermissionNotice below explains and offers "Open settings"
    try {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1, cameraType: ImagePicker.CameraType.front });
      if (!res.canceled && res.assets[0]) await uploadPicked(res.assets[0]);
    } catch {
      fail('errors.unexpected');
    }
  }, [cameraPermission?.granted, fail, requestCameraPermission, uploadPicked, uploading]);

  const removePhoto = useCallback(() => {
    Alert.alert(t('profile.avatar.removeTitle', 'Remove photo?'), t('profile.avatar.removeMessage', 'Your initials will be shown instead.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      {
        text: t('profile.avatar.remove', 'Remove photo'),
        style: 'destructive',
        onPress: async () => {
          setNotice(null);
          setProgress(0);
          const r = await actions.resetAvatar();
          setProgress(null);
          if (r.ok) { haptics.success(); setNotice({ kind: 'success', text: t('profile.avatar.removed', 'Photo removed') }); } else fail(r.key);
        },
      },
    ]);
  }, [actions, fail, t]);

  const saveName = useCallback(async () => {
    if (savingName) return;
    const v = validateUsername(name);
    if (!v.ok) { setNameError(t(v.key)); haptics.error(); return; }
    setNameError(null);
    setNotice(null);
    setSavingName(true);
    const r = await actions.changeUsername(name);
    setSavingName(false);
    if (r.ok) {
      haptics.success();
      setName(v.value);
      setNotice({ kind: 'success', text: t('profile.saved', 'Saved') });
    } else {
      setNameError(t(r.key));
      haptics.error();
    }
  }, [actions, name, savingName, t]);

  if (!user) return <Screen><Banner kind="error">{t('errors.unauthorized', 'Please sign in again.')}</Banner></Screen>;

  const dirty = name.trim().replace(/\s+/g, ' ') !== user.username;

  return (
    <Screen>
      <FadeIn>
        <Card style={{ alignItems: 'center', gap: space.lg, paddingVertical: space.xl }}>
          <ProfileAvatar uri={user.avatarUrl} name={user.username} seed={user.uniqueId} size={120} progress={progress} />
          {uploading && <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontSize: 14 }}>{t('profile.avatar.uploading', 'Uploading...')}</Text>}
          <View style={{ alignSelf: 'stretch', gap: space.sm }}>
            <Button variant="secondary" title={t('profile.avatar.library', 'Choose from library')} icon={<ImageIcon size={18} color={c.text} />} onPress={pickFromLibrary} disabled={uploading} />
            <Button variant="secondary" title={t('profile.avatar.camera', 'Take a photo')} icon={<Camera size={18} color={c.text} />} onPress={takePhoto} disabled={uploading} />
            {!!user.avatarUrl && (
              <Button variant="secondary" title={t('profile.avatar.remove', 'Remove photo')} icon={<Trash2 size={18} color={c.danger} />} onPress={removePhoto} disabled={uploading} />
            )}
          </View>
        </Card>
      </FadeIn>

      {cameraBlocked && <PermissionNotice title={t('profile.permission.cameraTitle', 'Camera access is off')} message={t('profile.permission.cameraMessage', 'To take a profile photo, allow camera access for this app in your phone settings.')} />}
      {photoBlocked && <PermissionNotice title={t('profile.permission.photosTitle', 'Photo access is off')} message={t('profile.permission.photosMessage', 'To choose a profile photo, allow access to your photos for this app in your phone settings.')} />}
      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <FadeIn delay={60} style={{ gap: space.lg }}>
        <Field
          ref={nameRef}
          label={t('profile.fields.name', 'Name')}
          value={name}
          onChangeText={(v) => { setName(v); if (nameError) setNameError(null); }}
          error={nameError}
          helper={t('profile.fields.nameHelp', '2–32 characters: letters, digits, spaces and . _ \' -')}
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          autoCapitalize="words"
          maxLength={40}
          onSubmitEditing={saveName}
        />
        <Button title={t('profile.actions.save', 'Save')} onPress={saveName} loading={savingName} disabled={!dirty} />
      </FadeIn>

      <FadeIn delay={120}>
        <Section footer={t('profile.fields.emailHelp', 'To change your email you confirm with your password.')}>
          <Row label={t('profile.fields.email', 'Email')} value={user.email} onPress={() => router.push('/tabs/settings-email')} />
        </Section>
      </FadeIn>
    </Screen>
  );
}
