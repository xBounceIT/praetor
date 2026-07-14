import type { EmailConfig } from '../../types';

export type EmailTestResult = {
  success: boolean;
  code: string;
  params?: Record<string, string>;
};

type EmailSettingsState = {
  formData: EmailConfig;
  originalConfig: EmailConfig;
  testEmail: string;
  testResult: EmailTestResult | null;
  isTestLoading: boolean;
  isSaving: boolean;
  isSaved: boolean;
  errors: Record<string, string>;
  testErrors: Record<string, string>;
};

export type StateUpdate<T> = T | ((prev: T) => T);

type EmailSettingsAction =
  | { type: 'loadConfig'; config: EmailConfig }
  | { type: 'setFormData'; update: StateUpdate<EmailConfig> }
  | { type: 'setOriginalConfig'; config: EmailConfig }
  | { type: 'setTestEmail'; value: string }
  | { type: 'setTestResult'; value: EmailTestResult | null }
  | { type: 'setIsTestLoading'; value: boolean }
  | { type: 'setIsSaving'; value: boolean }
  | { type: 'setIsSaved'; value: boolean }
  | { type: 'setErrors'; update: StateUpdate<Record<string, string>> }
  | { type: 'setTestErrors'; update: StateUpdate<Record<string, string>> };

const resolveStateUpdate = <T>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

export const emailSettingsReducer = (
  state: EmailSettingsState,
  action: EmailSettingsAction,
): EmailSettingsState => {
  switch (action.type) {
    case 'loadConfig':
      return { ...state, formData: action.config, originalConfig: action.config };
    case 'setFormData':
      return { ...state, formData: resolveStateUpdate(state.formData, action.update) };
    case 'setOriginalConfig':
      return { ...state, originalConfig: action.config };
    case 'setTestEmail':
      return { ...state, testEmail: action.value };
    case 'setTestResult':
      return { ...state, testResult: action.value };
    case 'setIsTestLoading':
      return { ...state, isTestLoading: action.value };
    case 'setIsSaving':
      return { ...state, isSaving: action.value };
    case 'setIsSaved':
      return { ...state, isSaved: action.value };
    case 'setErrors':
      return { ...state, errors: resolveStateUpdate(state.errors, action.update) };
    case 'setTestErrors':
      return { ...state, testErrors: resolveStateUpdate(state.testErrors, action.update) };
    default:
      return state;
  }
};
