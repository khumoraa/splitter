import { useNetInfo } from '@react-native-community/netinfo';

/** false only when the phone definitely has no connection (unknown counts as online). */
export function useOnline(): boolean {
  const net = useNetInfo();
  return !(net.isConnected === false || net.isInternetReachable === false);
}
