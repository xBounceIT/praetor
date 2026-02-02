import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

const specUrl = new URL('../../docs/api/openapi.json', import.meta.url).href;

const ApiDocsView: React.FC = () => (
  <div className="min-h-screen bg-white">
    <SwaggerUI url={specUrl} />
  </div>
);

export default ApiDocsView;
