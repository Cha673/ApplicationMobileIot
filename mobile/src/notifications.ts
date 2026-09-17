import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alertes',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D94F4F',
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  let status = permissions.status;

  if (status !== Notifications.PermissionStatus.GRANTED) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }

  if (status !== Notifications.PermissionStatus.GRANTED) {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

export async function showErrorNotification(
  message: string,
  title = 'Erreur détectée',
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: message,
      data: { type: 'error' },
    },
    trigger: null,
  });
}

export async function showDataUpdatedNotification(roomLabels: string[]): Promise<void> {
  const roomText = roomLabels.length === 1
    ? roomLabels[0]
    : `${roomLabels.length} salles`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Données mises à jour',
      body: `Nouvelle mesure disponible pour ${roomText}.`,
      data: { type: 'data-updated' },
    },
    trigger: null,
  });
}