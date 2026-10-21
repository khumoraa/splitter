import { FriendsView } from '@/features/friends/ui/FriendsView';

/** Old route kept for links and the bell icon: the requests tab of the friends screen. */
export default function FriendRequestsScreen() {
  return <FriendsView initialTab="requests" />;
}
