// A top-level form lets the browser follow the OAuth redirect to the client.
if (window.top === window.self && ['/consent', '/consent/'].includes(location.pathname)) {
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
