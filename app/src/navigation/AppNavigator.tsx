import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { MapTrifold } from 'phosphor-react-native/lib/module/icons/MapTrifold';
import { Cow } from 'phosphor-react-native/lib/module/icons/Cow';
import { Bell } from 'phosphor-react-native/lib/module/icons/Bell';
import { Broadcast } from 'phosphor-react-native/lib/module/icons/Broadcast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
      <Tab.Screen name="Map" component={MapScreen} options={{ tabBarLabel: 'Карта', tabBarIcon: ({ color, size, focused }) => <MapTrifold color={color} size={size} weight={focused ? 'fill' : 'regular'} /> }} />
      <Tab.Screen name="Herd" component={HerdScreen} options={{ tabBarLabel: 'Стадо', tabBarIcon: ({ color, size, focused }) => <Cow color={color} size={size} weight={focused ? 'fill' : 'regular'} /> }} />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarLabel: 'Оповещения',
          tabBarIcon: ({ color, size, focused }) => <Bell color={color} size={size} weight={focused ? 'fill' : 'regular'} />,
          tabBarBadge: active > 0 ? active : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.signalMap, color: colors.ink },
        }}
      />
      <Tab.Screen name="Collars" component={CollarsScreen} options={{ tabBarLabel: 'Ошейники', tabBarIcon: ({ color, size, focused }) => <Broadcast color={color} size={size} weight={focused ? 'fill' : 'regular'} /> }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { colors } = useTheme();
  const { user, ready, restoring, dataMode } = useSession();
  const insets = useSafeAreaInsets();
  const { spacing, typography } = useTheme();
  if (restoring) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
    {ready && dataMode !== 'REAL' && (
      <View
        accessibilityRole="alert"
        style={{ backgroundColor: colors.warning, paddingTop: insets.top + 2, paddingBottom: 4, paddingHorizontal: spacing.lg }}
      >
        <Text style={[typography.caption, { color: colors.onPrimary, fontWeight: '700', textAlign: 'center' }]}>
          Демо: {dataMode === 'AUTO' ? 'автоматическая симуляция' : 'пилотный режим'}. Данные не настоящие.
        </Text>
      </View>
    )}
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
    </View>
  );
}
