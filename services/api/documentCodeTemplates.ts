import type { DocumentCodeModuleId, DocumentCodePreview, DocumentCodeTemplate } from '../../types';
import { fetchApi } from './client';

export type DocumentCodeTemplateUpdate = Pick<
  DocumentCodeTemplate,
  'moduleId' | 'prefix' | 'template' | 'sequencePadding'
>;

export const documentCodeTemplatesApi = {
  list: (): Promise<DocumentCodeTemplate[]> =>
    fetchApi<DocumentCodeTemplate[]>('/document-code-templates'),

  preview: (moduleId: DocumentCodeModuleId, date?: string): Promise<DocumentCodePreview> => {
    const params = new URLSearchParams({ moduleId });
    if (date) params.set('date', date);
    return fetchApi<DocumentCodePreview>(`/document-code-templates/preview?${params.toString()}`);
  },

  update: (templates: DocumentCodeTemplateUpdate[]): Promise<DocumentCodeTemplate[]> =>
    fetchApi<DocumentCodeTemplate[]>('/document-code-templates', {
      method: 'PUT',
      body: JSON.stringify({ templates }),
    }),
};
