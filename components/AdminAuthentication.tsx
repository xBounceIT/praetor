import React, { useState } from 'react';
import { LdapConfig, UserRole } from '../types';
import CustomSelect from './CustomSelect';

interface AdminAuthenticationProps {
  config: LdapConfig;
  onSave: (config: LdapConfig) => void;
}

const DEFAULT_CONFIG: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: 'cn=read-only-admin,dc=example,dc=com',
  bindPassword: '',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
};

const AdminAuthentication: React.FC<AdminAuthenticationProps> = ({ config, onSave }) => {
  const [formData, setFormData] = useState<LdapConfig>(config || DEFAULT_CONFIG);
  const [testUser, setTestUser] = useState('');
  const [testPass, setTestPass] = useState('');
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
  } | null>(null);
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!formData.enabled) {
      onSave(formData);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
      return;
    }

    const newErrors: Record<string, string> = {};

    if (!formData.serverUrl?.trim()) newErrors.serverUrl = 'Server URL is required';
    if (!formData.baseDn?.trim()) newErrors.baseDn = 'Base DN is required';
    if (!formData.userFilter?.trim()) newErrors.userFilter = 'User filter is required';
    if (!formData.groupBaseDn?.trim()) newErrors.groupBaseDn = 'Group Base DN is required';
    if (!formData.groupFilter?.trim()) newErrors.groupFilter = 'Group filter is required';

    if (
      (formData.bindDn && !formData.bindPassword) ||
      (!formData.bindDn && formData.bindPassword)
    ) {
      newErrors.bindCredentials = 'Both Bind DN and Bind Password are required together';
    }

    if (formData.roleMappings) {
      formData.roleMappings.forEach((mapping, idx) => {
        if (!mapping.ldapGroup?.trim()) {
          newErrors[`roleMapping_${idx}`] = 'LDAP Group is required';
        }
      });
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestErrors({});
    setTestResult(null);

    const newErrors: Record<string, string> = {};
    if (!testUser?.trim()) newErrors.testUser = 'Test username is required';
    if (!testPass?.trim()) newErrors.testPass = 'Test password is required';
    if (!formData.enabled) newErrors.enabled = 'LDAP must be enabled to test';

    if (Object.keys(newErrors).length > 0) {
      setTestErrors(newErrors);
      return;
    }

    setIsTestLoading(true);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mock Validation Logic
    if (
      formData.serverUrl.includes('example.com') &&
      testUser === 'admin' &&
      testPass === 'password'
    ) {
      setTestResult({
        success: true,
        message: 'Successfully authenticated and authorized.',
        details: {
          dn: `uid=${testUser},ou=people,${formData.baseDn}`,
          groups: [
            'cn=admins,ou=groups,' + formData.baseDn,
            'cn=devs,ou=groups,' + formData.baseDn,
          ],
          mappedRole: 'admin',
        },
      });
    } else if (testUser === 'jdoe' && testPass === 'password') {
      setTestResult({
        success: true,
        message: 'Successfully authenticated and authorized.',
        details: {
          dn: `uid=${testUser},ou=people,${formData.baseDn}`,
          groups: ['cn=users,ou=groups,' + formData.baseDn],
          mappedRole: 'user',
        },
      });
    } else {
      setTestResult({
        success: false,
        message: 'Authentication failed. Invalid credentials or connection error.',
      });
    }
    setIsTestLoading(false);
  };

  const addRoleMapping = () => {
    setFormData({
      ...formData,
      roleMappings: [...formData.roleMappings, { ldapGroup: '', praetorRole: 'user' }],
    });
  };

  const removeRoleMapping = (index: number) => {
    const newMappings = [...formData.roleMappings];
    newMappings.splice(index, 1);
    setFormData({ ...formData, roleMappings: newMappings });
  };

  const updateRoleMapping = (index: number, field: 'ldapGroup' | 'praetorRole', value: string) => {
    const newMappings = [...formData.roleMappings];
    newMappings[index] = { ...newMappings[index], [field]: value };
    setFormData({ ...formData, roleMappings: newMappings });
    if (errors[`roleMapping_${index}`]) setErrors({ ...errors, [`roleMapping_${index}`]: '' });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Authentication Settings</h2>
          <p className="text-sm text-slate-500 mt-1">Configure LDAP/Active Directory integration</p>
        </div>
        {isSaved && (
          <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
            <i className="fa-solid fa-check"></i> Changes Saved
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Connection Settings */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <i className="fa-solid fa-server text-praetor"></i>
              <h3 className="font-bold text-slate-800">LDAP Server Configuration</h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
              <span className="ms-3 text-sm font-medium text-slate-600">Enabled</span>
            </label>
          </div>

          <div
            className={`p-6 grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Server URL
              </label>
              <input
                type="text"
                value={formData.serverUrl}
                onChange={(e) => {
                  setFormData({ ...formData, serverUrl: e.target.value });
                  if (errors.serverUrl) setErrors({ ...errors, serverUrl: '' });
                }}
                placeholder="ldap://ldap.example.com:389"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.serverUrl ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.serverUrl && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.serverUrl}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Base DN
              </label>
              <input
                type="text"
                value={formData.baseDn}
                onChange={(e) => {
                  setFormData({ ...formData, baseDn: e.target.value });
                  if (errors.baseDn) setErrors({ ...errors, baseDn: '' });
                }}
                placeholder="dc=example,dc=com"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.baseDn ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.baseDn && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.baseDn}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                User Search Filter
              </label>
              <input
                type="text"
                value={formData.userFilter}
                onChange={(e) => {
                  setFormData({ ...formData, userFilter: e.target.value });
                  if (errors.userFilter) setErrors({ ...errors, userFilter: '' });
                }}
                placeholder="(uid={0}) or (sAMAccountName={0})"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.userFilter ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.userFilter && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.userFilter}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Bind DN (Optional)
              </label>
              <input
                type="text"
                value={formData.bindDn}
                onChange={(e) => {
                  setFormData({ ...formData, bindDn: e.target.value });
                  if (errors.bindCredentials) setErrors({ ...errors, bindCredentials: '' });
                }}
                placeholder="cn=admin,dc=example,dc=com"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.bindCredentials ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Bind Password
              </label>
              <input
                type="password"
                value={formData.bindPassword}
                onChange={(e) => {
                  setFormData({ ...formData, bindPassword: e.target.value });
                  if (errors.bindCredentials) setErrors({ ...errors, bindCredentials: '' });
                }}
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.bindCredentials ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.bindCredentials && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.bindCredentials}</p>
              )}
            </div>
          </div>
        </section>

        {/* Authorization & Provisioning */}
        <section
          className={`bg-white rounded-2xl border border-slate-200 shadow-sm transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-users-gear text-praetor"></i>
            <h3 className="font-bold text-slate-800">Authorization & Provisioning</h3>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Group Search Base
                </label>
                <input
                  type="text"
                  value={formData.groupBaseDn}
                  onChange={(e) => {
                    setFormData({ ...formData, groupBaseDn: e.target.value });
                    if (errors.groupBaseDn) setErrors({ ...errors, groupBaseDn: '' });
                  }}
                  placeholder="ou=groups,dc=example,dc=com"
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.groupBaseDn ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                />
                {errors.groupBaseDn && (
                  <p className="text-red-500 text-[10px] font-bold mt-1">{errors.groupBaseDn}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Group Member Filter
                </label>
                <input
                  type="text"
                  value={formData.groupFilter}
                  onChange={(e) => {
                    setFormData({ ...formData, groupFilter: e.target.value });
                    if (errors.groupFilter) setErrors({ ...errors, groupFilter: '' });
                  }}
                  placeholder="(member={0}) or (memberUid={0})"
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.groupFilter ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                />
                {errors.groupFilter && (
                  <p className="text-red-500 text-[10px] font-bold mt-1">{errors.groupFilter}</p>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-6">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-slate-800">Role Mappings</h4>
                <button
                  type="button"
                  onClick={addRoleMapping}
                  className="text-xs bg-slate-100 text-praetor px-3 py-1.5 rounded-lg font-bold hover:bg-slate-200 transition-colors"
                >
                  <i className="fa-solid fa-plus mr-1"></i> Add Mapping
                </button>
              </div>

              <div className="space-y-3">
                {formData.roleMappings.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No mappings configured. Users will be assigned &apos;User&apos; role by default
                    if not specified.
                  </p>
                ) : (
                  formData.roleMappings.map((mapping, idx) => (
                    <div key={idx} className="flex gap-4 items-center">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={mapping.ldapGroup}
                          onChange={(e) => updateRoleMapping(idx, 'ldapGroup', e.target.value)}
                          placeholder="LDAP Group CN (e.g. cn=admins)"
                          className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm font-mono focus:ring-2 outline-none ${errors[`roleMapping_${idx}`] ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'focus:ring-praetor border-slate-200'}`}
                        />
                        {errors[`roleMapping_${idx}`] && (
                          <p className="text-red-500 text-[10px] font-bold mt-1">
                            {errors[`roleMapping_${idx}`]}
                          </p>
                        )}
                      </div>
                      <i className="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
                      <div className="w-40">
                        <CustomSelect
                          options={[
                            { id: 'admin', name: 'Admin' },
                            { id: 'manager', name: 'Manager' },
                            { id: 'user', name: 'User' },
                          ]}
                          value={mapping.praetorRole}
                          onChange={(val) => updateRoleMapping(idx, 'praetorRole', val as UserRole)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRoleMapping(idx)}
                        className="text-slate-400 hover:text-red-500 p-2"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            className="bg-praetor text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all active:scale-95"
          >
            Save Configuration
          </button>
        </div>
      </form>

      {/* Tester */}
      <section
        className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-12 transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
          <i className="fa-solid fa-vial text-praetor"></i>
          <h3 className="font-bold text-slate-800">Connection Tester</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <p className="text-xs text-slate-400 mb-4">
              Enter credentials to test authentication and group retrieval against the current
              configuration.
            </p>
            <form onSubmit={handleTest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Test Username
                </label>
                <input
                  type="text"
                  value={testUser}
                  onChange={(e) => {
                    setTestUser(e.target.value);
                    if (testErrors.testUser) setTestErrors({ ...testErrors, testUser: '' });
                  }}
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold text-slate-700 ${testErrors.testUser ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                />
                {testErrors.testUser && (
                  <p className="text-red-500 text-[10px] font-bold mt-1">{testErrors.testUser}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Test Password
                </label>
                <input
                  type="password"
                  value={testPass}
                  onChange={(e) => {
                    setTestPass(e.target.value);
                    if (testErrors.testPass) setTestErrors({ ...testErrors, testPass: '' });
                  }}
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold text-slate-700 ${testErrors.testPass ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                />
                {testErrors.testPass && (
                  <p className="text-red-500 text-[10px] font-bold mt-1">{testErrors.testPass}</p>
                )}
                {testErrors.enabled && (
                  <p className="text-amber-600 text-[10px] font-bold mt-1">{testErrors.enabled}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={isTestLoading || !formData.enabled}
                className="w-full bg-praetor text-white py-2 rounded-lg font-bold hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-md shadow-slate-100"
              >
                {isTestLoading ? (
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                ) : (
                  'Test Authentication'
                )}
              </button>
            </form>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs overflow-y-auto h-64 border border-slate-800 shadow-inner">
            {isTestLoading ? (
              <div className="text-slate-400 animate-pulse">Connecting to LDAP server...</div>
            ) : testResult ? (
              <div className="space-y-2">
                <div
                  className={`font-bold ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  [{testResult.success ? 'SUCCESS' : 'FAILURE'}] {testResult.message}
                </div>
                {testResult.details && (
                  <>
                    <div className="text-slate-500 mt-2 border-b border-slate-800 pb-1 mb-2">
                      -- Provisioning Details --
                    </div>
                    <div className="text-slate-400">
                      DN: <span className="text-slate-200">{testResult.details.dn}</span>
                    </div>
                    <div className="text-slate-400">
                      Role:{' '}
                      <span className="text-slate-400 uppercase font-bold">
                        {testResult.details.mappedRole}
                      </span>
                    </div>
                    <div className="text-slate-400 mt-2">Groups Found:</div>
                    <ul className="list-disc pl-4 text-slate-500">
                      {testResult.details.groups.map((g: string, i: number) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <div className="text-slate-600 italic">
                Waiting for test execution...
                <br />
                <br />
                <span className="opacity-50">Log output will appear here after testing.</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdminAuthentication;
