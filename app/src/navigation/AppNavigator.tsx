import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/tokens';

import { MapScreen } from '../screens/MapScreen';
import { HerdScreen } from '../screens/HerdScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { CollarsScreen } from '../screens/CollarsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AnimalProfileScreen } from '../screens/AnimalProfileScreen';
import { LoginScreen } from '../screens/LoginScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface1,
          borderTopColor: colors.borderSubtle,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.ink2,
      }}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ tabBarLabel: 'Карта' }} />
      <Tab.Screen name="Herd" component={HerdScreen} options={{ tabBarLabel: 'Стадо' }} />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarLabel: 'Оповещения', tabBarBadge: 3, tabBarBadgeStyle: { backgroundColor: colors.signal } }}
      />
      <Tab.Screen name="Collars" component={CollarsScreen} options={{ tabBarLabel: 'Ошейники' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface0 } }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Profile" component={AnimalProfileScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

