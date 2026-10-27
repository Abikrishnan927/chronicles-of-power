(function () {
  window.COPSupportErrorLink = (error, operation) => {
    const params = new URLSearchParams({
      explainError: '1',
      errorCode: String(error.code || 'APP-1001').slice(0, 20),
      errorTitle: String(error.title || 'Support Service Unavailable').slice(0, 100),
      errorMessage: String(error.message || 'The request could not be completed.').slice(0, 180),
      errorCause: String(error.cause || '').slice(0, 120),
      errorSteps: (Array.isArray(error.steps) ? error.steps : []).slice(0, 3).join('; ').slice(0, 180),
      errorRequestId: String(error.requestId || '').slice(0, 60),
      errorPage: location.pathname.slice(0, 100),
      errorOperation: String(operation || 'using the game').slice(0, 80)
    });
    if (error.siteCode) params.set('errorSiteCode', String(error.siteCode).slice(0, 30));
    const supportUrl = window.COPDeployment?.asset('support/index.html') || 'support/index.html';
    return `${supportUrl}?${params}`;
  };
}());
