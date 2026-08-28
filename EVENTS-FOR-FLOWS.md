# Amie email platform — events & traits you can build flows on

Every Amie customer already exists in the platform (9,600+ imported), and the
patient portal streams these live as things happen. Build segments and
journeys on them.

## Events (journey triggers / segment conditions)
| Event | Fires when | Useful properties |
|---|---|---|
| `order_paid` | A customer's order is paid (web funnel) | `orderId`, `total`, `productHandle`, `isFirstOrder` |
| `subscription_started` | New subscription begins | `subscriptionId`, `productHandle`, `amountCents` |
| `subscription_renewed` | A renewal bills successfully | same |
| `subscription_cancelled` | Subscription cancelled (any channel) | same |
| `refund_issued` | A refund is processed | `amountCents`, `orderId` |
| `intake_completed` | Medical intake finished (case created) | `workflowId` |

## Traits (on every customer — from the initial import + kept fresh)
`email`, `firstName`, `lastName`, `createdAt`, `lastOrderAt`,
`productHandle(s)`, `subscriptionStatus`, `totalOrders`, `isFirstOrder`.

## Flow ideas that work with today's events
- Welcome / onboarding: trigger `order_paid` where `isFirstOrder = true`
- Intake nudge: trigger `order_paid`, wait 2 days, exit early if
  `intake_completed` fired, else send reminder (repeat at day 4)
- Cancel save / winback: trigger `subscription_cancelled`, wait N days, offer
- Renewal thank-you or upsell: trigger `subscription_renewed`
- Refund follow-up: trigger `refund_issued`

## Not available yet (coming when we migrate those flows)
Quiz-completed / abandoned-checkout leads (people who never purchased) —
those flows stay in Mautic until the lead events are added.

## Ground rules
- Send from `Amie <hello@em.tryamie.com>` (preconfigured default).
- Unsubscribes are enforced platform-wide automatically — never work around a
  suppression.
- New sending domain: keep early sends small (hundreds/day) and ramp up over
  ~2 weeks; we'll watch deliverability stats together as volume grows.
