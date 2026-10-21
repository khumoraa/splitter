import { FriendsView } from '@/features/friends/ui/FriendsView';

/** Old route kept for links: the search tab of the friends screen. */
export default function FriendSearchScreen() {
  return <FriendsView initialTab="find" />;
}
