import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/scale';
import { useSession } from '../state/session';
import { api } from '../services/api';

import { MapScreen } from '../screens/MapScreen';
import { HerdScreen } from '../screens/HerdScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { CollarsScreen } from '../screens/CollarsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AnimalProfileScreen } from '../screens/AnimalProfileScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { AddAnimalScreen } from '../screens/AddAnimalScreen';
import { FarmSelectScreen } from '../screens/FarmSelectScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { colors, sizes, typography, spacing } = useTheme();
  const [active, setActive] = useState(0);

  // real badge: number of active alerts, refreshed every minute
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getAlertStats()
        .then((s) => alive && setActive(s.activeTotal))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface3,
          borderTopWidth: 0,
          height: sizes.nav,
          paddingBottom: spacing.sm,
          paddingTop: spacing.sm,
        },
        tabBarLabelStyle: {
          fontSize: typography.nav.fontSize,
          lineHeight: typography.nav.lineHeight,
          fontWeight: typography.nav.fontWeight,
        },
        tabBarActiveTintColor: colors.onPrimary,
        tabBarInactiveTintColor: colors.navText,
      }}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ tabBarLabel: 'Карта' }} />
      <Tab.Screen name="Herd" component={HerdScreen} options={{ tabBarLabel: 'Стадо' }} />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarLabel: 'Оповещения',
          tabBarBadge: active > 0 ? active : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.signalMap, color: colors.ink },
        }}
      />
      <Tab.Screen name="Collars" component={CollarsScreen} options={{ tabBarLabel: 'Ошейники' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { colors } = useTheme();
  const { user, ready, restoring } = useSession();
  if (restoring) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface0 } }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !ready ? (
          <Stack.Screen name="FarmSelect" component={FarmSelectScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Profile" component={AnimalProfileScreen} />
            <Stack.Screen name="AddAnimal" component={AddAnimalScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
