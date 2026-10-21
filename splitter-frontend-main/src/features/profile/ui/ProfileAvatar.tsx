import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { avatarColorFor, initialsOf } from '../lib/avatar-style';

type Props = {
  uri?: string | null;
  /** display name, for the initials and the accessibility label */
  name?: string | null;
  /** stable seed (uniqueId) so the placeholder colour does not change when the name does */
  seed?: string | null;
  size?: number;
  onPress?: () => void;
  /** 0..100 while a new photo is uploading */
  progress?: number | null;
};

/** Photo with an on-disk cache (expo-image); initials on a colour when there is none or it fails to load. */
export function ProfileAvatar({ uri, name, seed, size = 96, onPress, progress }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const showImage = !!uri && !failed;
  const body = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: avatarColorFor(seed ?? name), alignItems: 'center', justifyContent: 'center' }}>
      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="disk"
          transition={150}
          recyclingKey={uri!}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontSize: Math.round(size * 0.38), fontWeight: '700' }}>{initialsOf(name)}</Text>
      )}
      {progress != null && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontWeight: '700', fontSize: Math.round(size * 0.22) }}>{progress}%</Text>
        </View>
      )}
    </View>
  );
  const label = name ? t('profile.avatar.a11y', { name, defaultValue: 'Photo of {{name}}' }) : t('profile.avatar.a11yNoName', 'Profile photo');
  if (!onPress) return <View accessible accessibilityRole="image" accessibilityLabel={label}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('profile.avatar.change', 'Change photo')} hitSlop={8}>
      {body}
    </Pressable>
  );
}
