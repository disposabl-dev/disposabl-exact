// Sign-in callbacks and payment redirects run only in the top-level web app.
if (window.top === window.self) {
  globalThis.exactPlatformWeb = true;
  globalThis.goToBilling = (url) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') throw new Error('Invalid billing URL');
    window.location.assign(target.href);
  };
  // A top-level form lets the browser follow the OAuth redirect to the client.
  globalThis.submitMcpConsent = (request, decision) => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/api/mcp/consent';
    for (const [name, value] of Object.entries({ request, decision })) {
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = name;
      field.value = value;
      form.append(field);
    }
    document.body.append(form);
    form.requestSubmit();
  };
}
