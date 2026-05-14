import type React from 'react';
import api from '../../services/api';
import type { LdapConfig } from '../../types';

export type LdapHandlersDeps = {
  setLdapConfig: React.Dispatch<React.SetStateAction<LdapConfig>>;
};

export const makeLdapHandlers = ({ setLdapConfig }: LdapHandlersDeps) => {
  const saveConfig = async (config: LdapConfig) => {
    try {
      const updated = await api.ldap.updateConfig(config);
      setLdapConfig(updated);
    } catch (err) {
      console.error('Failed to save LDAP config:', err);
      throw err;
    }
  };

  return { saveConfig };
};
