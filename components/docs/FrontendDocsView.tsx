const frontendDocsIndexUrl = new URL('../../docs/frontend/index.html', import.meta.url).href;
const frontendDocsHierarchyUrl = new URL(
  '../../docs/frontend/assets/hierarchy.js',
  import.meta.url,
).href;

const FrontendDocsView: React.FC = () => {
  if (window.location.pathname === '/docs/frontend') {
    window.location.replace(frontendDocsIndexUrl);
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center">
      <link rel="prefetch" href={frontendDocsHierarchyUrl} as="script" />
      <a className="text-praetor font-semibold" href={frontendDocsIndexUrl}>
        Open frontend documentation
      </a>
    </div>
  );
};

export default FrontendDocsView;
