import type { DocumentCodeTemplate } from '../../types';
import { fetchApi } from './client';

export type DocumentCodeTemplateUpdate = Pick<
  DocumentCodeTemplate,
  'moduleId' | 'prefix' | 'template' | 'sequencePadding'
>;

export const documentCodeTemplatesApi = {
  list: (): Promise<DocumentCodeTemplate[]> =>
    fetchApi<DocumentCodeTemplate[]>('/document-code-templates'),

  update: (templates: DocumentCodeTemplateUpdate[]): Promise<DocumentCodeTemplate[]> =>
    fetchApi<DocumentCodeTemplate[]>('/document-code-templates', {
      method: 'PUT',
      body: JSON.stringify({ templates }),
    }),
};
