import type { FigNode, Figure } from '../src';

const part = (id: string, label: string, source: string, inside?: FigNode['inside']): FigNode => ({
  id,
  label,
  source: `examples/shop/${source}`,
  ...(inside && { inside }),
});
const chain = (ids: string[]) => ids.slice(1).map((to, i) => ({ from: ids[i], to }));
const step = (label: string, ids: string[]) => ({ label, flow: chain(ids).map((e) => `${e.from}->${e.to}`) });

const auth = {
  layout: {
    auto: true,
    children: [
      part('read-token', 'Read the token', 'auth.ts#readToken'),
      part('verify-sig', 'Check the signature', 'auth.ts#verifySignature'),
      part('load-user', 'Load the user', 'auth.ts#loadUser'),
      part('check-role', 'Check the role', 'auth.ts#checkRole'),
      part('issue-ctx', 'Make the context', 'auth.ts#issueContext'),
    ],
  },
  edges: chain(['route', 'read-token', 'verify-sig', 'load-user', 'check-role', 'issue-ctx', 'limit']),
  steps: [step('Sign in the caller', ['route', 'read-token', 'verify-sig', 'load-user', 'check-role', 'issue-ctx', 'limit'])],
} satisfies FigNode['inside'];

const gateway = {
  layout: {
    auto: true,
    children: [
      part('route', 'Route the call', 'gateway.ts#route'),
      part('auth', 'Sign in', 'gateway.ts#authenticate', auth),
      part('limit', 'Rate limit', 'gateway.ts#rateLimit'),
    ],
  },
  edges: [...chain(['browser', 'route', 'auth', 'limit', 'orders']), { from: 'limit', to: 'cart' }],
  steps: [step('Route a request', ['browser', 'route', 'auth', 'limit', 'orders'])],
} satisfies FigNode['inside'];

const price = {
  layout: {
    auto: true,
    children: [
      part('load-rules', 'Load the price rules', 'pricing.ts#loadRules'),
      part('apply-discount', 'Apply the discount', 'pricing.ts#applyDiscount'),
      part('add-tax', 'Add the tax', 'pricing.ts#addTax'),
      part('round-total', 'Round the total', 'pricing.ts#roundTotal'),
      part('sum-cart', 'Sum the cart', 'pricing.ts#sumCart'),
    ],
  },
  edges: chain(['add-item', 'load-rules', 'apply-discount', 'add-tax', 'round-total', 'sum-cart', 'save-cart']),
  steps: [step('Price the cart', ['add-item', 'load-rules', 'apply-discount', 'add-tax', 'round-total', 'sum-cart', 'save-cart'])],
} satisfies FigNode['inside'];

const cart = {
  layout: {
    auto: true,
    children: [
      part('find-cart', 'Find the cart', 'cart.ts#findCart'),
      part('add-item', 'Add the item', 'cart.ts#addItem'),
      part('price', 'Price the cart', 'cart.ts#priceCart', price),
      part('save-cart', 'Save the cart', 'cart.ts#saveCart'),
    ],
  },
  edges: chain(['gateway', 'find-cart', 'add-item', 'price', 'save-cart']),
  steps: [step('Add an item', ['gateway', 'find-cart', 'add-item', 'price', 'save-cart'])],
} satisfies FigNode['inside'];

const validate = {
  layout: {
    auto: true,
    children: [
      part('parse-cart', 'Parse the cart', 'validate.ts#parseCart'),
      part('check-items', 'Check the items', 'validate.ts#checkItems'),
      part('check-stock', 'Check the stock', 'validate.ts#checkStock'),
      part('check-address', 'Check the address', 'validate.ts#checkAddress'),
      part('check-limits', 'Check the limits', 'validate.ts#checkLimits'),
    ],
  },
  edges: chain(['gateway', 'parse-cart', 'check-items', 'check-stock', 'check-address', 'check-limits', 'reserve']),
  steps: [step('Check the cart', ['gateway', 'parse-cart', 'check-items', 'check-stock', 'check-address', 'check-limits', 'reserve'])],
} satisfies FigNode['inside'];

const orders = {
  layout: {
    direction: 'row',
    children: [
      part('validate', 'Check the cart', 'orders.ts#validateCart', validate),
      part('reserve', 'Reserve the stock', 'orders.ts#reserveStock'),
      part('total', 'Sum the order', 'orders.ts#sumOrder'),
      part('save', 'Save the order', 'orders.ts#insertOrder'),
      part('publish', 'Publish the event', 'orders.ts#publishPlaced'),
    ],
  },
  edges: chain(['gateway', 'validate', 'reserve', 'total', 'save', 'publish', 'payments']),
  steps: [step('Place an order', ['gateway', 'validate', 'reserve', 'total', 'save', 'publish', 'payments'])],
} satisfies FigNode['inside'];

const chargeCard = {
  layout: {
    auto: true,
    children: [
      part('tokenize', 'Make a card token', 'psp.ts#tokenize'),
      part('call-psp', 'Call the provider', 'psp.ts#callProvider'),
      part('check-3ds', 'Check 3-D Secure', 'psp.ts#check3ds'),
      part('capture', 'Capture the money', 'psp.ts#capture'),
      part('map-result', 'Read the result', 'psp.ts#mapResult'),
    ],
  },
  edges: chain(['create-intent', 'tokenize', 'call-psp', 'check-3ds', 'capture', 'map-result', 'record']),
  steps: [step('Charge the card', ['create-intent', 'tokenize', 'call-psp', 'check-3ds', 'capture', 'map-result', 'record'])],
} satisfies FigNode['inside'];

const payments = {
  layout: {
    auto: true,
    children: [
      part('create-intent', 'Make the intent', 'payments.ts#createIntent'),
      part('charge-card', 'Charge the card', 'payments.ts#chargeCard', chargeCard),
      part('record', 'Record the payment', 'payments.ts#recordPayment'),
      part('emit', 'Send the event', 'payments.ts#emitPaid'),
    ],
  },
  edges: chain(['orders', 'create-intent', 'charge-card', 'record', 'emit', 'mail']),
  steps: [step('Take a payment', ['orders', 'create-intent', 'charge-card', 'record', 'emit', 'mail'])],
} satisfies FigNode['inside'];

const mail = {
  layout: {
    direction: 'column',
    children: [
      part('pick-template', 'Pick the template', 'mail.ts#pickTemplate'),
      part('render-mail', 'Fill the template', 'mail.ts#renderMail'),
      part('queue-mail', 'Queue the mail', 'mail.ts#queueMail'),
      part('send-mail', 'Send the mail', 'mail.ts#sendMail'),
    ],
  },
  edges: chain(['payments', 'pick-template', 'render-mail', 'queue-mail', 'send-mail']),
  steps: [step('Send the receipt', ['payments', 'pick-template', 'render-mail', 'queue-mail', 'send-mail'])],
} satisfies FigNode['inside'];

const props: Figure['props'] = {
  layout: {
    label: 'Shop',
    children: [
      { id: 'browser', label: 'Browser' },
      { id: 'gateway', label: 'Gateway', source: 'examples/shop/gateway.ts#checkout', inside: gateway },
      {
        direction: 'column',
        children: [
          { id: 'cart', label: 'Cart', source: 'examples/shop/cart.ts#updateCart', inside: cart },
          { id: 'orders', label: 'Orders', source: 'examples/shop/orders.ts#createOrder', inside: orders },
        ],
      },
      { id: 'payments', label: 'Payments', source: 'examples/shop/payments.ts#charge', inside: payments },
      { id: 'mail', label: 'Mail', source: 'examples/shop/mail.ts#sendReceipt', inside: mail },
    ],
  },
  edges: chain(['browser', 'gateway', 'orders', 'payments', 'mail']).concat({ from: 'gateway', to: 'cart' }),
  steps: [
    {
      label: 'Add to cart',
      flow: [
        { edges: 'browser->gateway', say: 'The browser sends the item.' },
        { edges: 'gateway->cart', say: 'The gateway adds the item to the cart.' },
      ],
    },
    {
      label: 'Place an order',
      flow: [
        { edges: 'browser->gateway', say: 'The browser sends the order.' },
        { edges: 'gateway->orders', say: 'The gateway asks Orders to place the order.' },
        { edges: 'orders->payments', say: 'Orders asks Payments to charge the card.' },
        { edges: 'payments->mail', say: 'Payments asks Mail to send the receipt.' },
      ],
    },
  ],
};

export default { title: 'Shop', props } satisfies Figure;
