(function () {
  const scriptUrl = document.currentScript?.src || location.href;
  const basePath = new URL('.', scriptUrl).pathname;
  window.COPDeployment = Object.freeze({
    basePath,
    backendConfigured: false,
    backendBaseUrl: null,
    asset(path) {
      return new URL(String(path).replace(/^\/+/, ''), `${location.origin}${basePath}`).href;
    },
    api(path) {
      if (!this.backendConfigured) {
        const error = new Error('This feature requires a separately hosted Node.js backend.');
        error.code = 'BACKEND_NOT_CONFIGURED';
        error.title = 'Backend Required';
        error.cause = 'GitHub Pages serves static files and does not run the project’s Express API.';
        error.steps = ['The historical catalogue and game remain available.', 'Configure a hosted backend to enable AI, ticket, and support APIs.'];
        error.retryable = false;
        throw error;
      }
      const base = this.backendBaseUrl || location.origin;
      return new URL(String(path).replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).href;
    }
  });
}());
