import { createContext, useContext } from 'react';

import type { MerchantSettings } from '@kit';

/** What VIBE decided for this kind of business (set on its category): whether it uses bills, and what its item list is called. */
export const SettingsContext = createContext<MerchantSettings>({ payRedeem: true, menuLabel: 'Menu' });

export const useSettings = () => useContext(SettingsContext);
