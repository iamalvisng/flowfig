export function sendReceipt(amount: number) {
  return { to: 'ada@example.com', amount };
}

export function pickTemplate(amount: number) {
  return renderMail(amount > 0 ? 'receipt' : 'refund');
}

export function renderMail(template: string) {
  return queueMail(`<p>${template}</p>`);
}

export function queueMail(body: string) {
  return sendMail(body);
}

export function sendMail(body: string) {
  return { sent: body.length > 0 };
}
