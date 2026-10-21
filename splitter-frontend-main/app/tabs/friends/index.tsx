import { useLocalSearchParams } from 'expo-router';
import { FriendsView, type FriendsTab } from '@/features/friends/ui/FriendsView';

export default function FriendsScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initial: FriendsTab = tab === 'requests' || tab === 'find' ? tab : 'friends';
  return <FriendsView key={initial} initialTab={initial} />;
}
