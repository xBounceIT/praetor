const FrontendDocsView: React.FC = () => {
  if (window.location.pathname === '/docs/frontend') {
    window.location.replace('/docs/frontend/index.html');
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <a className="text-praetor font-semibold" href="/docs/frontend/index.html">
        Open frontend documentation
      </a>
    </div>
  );
};

export default FrontendDocsView;
