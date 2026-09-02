import { AmieBlockSpec } from "isomorphic-lib/src/amieComposer";

export interface AmieRecipe {
  id: "winback" | "launch" | "newsletter" | "promo" | "welcome";
  name: string;
  description: string;
  prompt: string;
  seedBlocks: AmieBlockSpec[];
}

const footer: AmieBlockSpec = {
  type: "footer",
  params: { addressLine: "Configured by server", unsubscribe: "Unsubscribe" },
};

export const AMIE_RECIPES: AmieRecipe[] = [
  {
    id: "winback",
    name: "Winback",
    description: "Reconnect with a warm, specific reason to return.",
    prompt:
      "Create a fresh winback email. Fill this skeleton with persuasive, empathetic copy and a complete varied design.",
    seedBlocks: [
      { type: "header", params: {} },
      { type: "heroHeading", params: { title: "Welcome back" } },
      { type: "paragraph", params: { text: "Reconnect with the reader." } },
      {
        type: "twoColumn",
        params: {
          image: {
            src: "https://generated.amie.invalid/pending",
            alt: "Warm lifestyle moment",
          },
          imageSide: "left",
          body: "Give her a specific reason to return.",
        },
      },
      {
        type: "ctaButton",
        params: { label: "Come back to Amie", url: "https://tryamie.com" },
      },
      footer,
    ],
  },
  {
    id: "launch",
    name: "Product launch",
    description: "Introduce what is new with proof and product focus.",
    prompt:
      "Create a product launch email from this skeleton. Make the hierarchy and styling feel like a full art-directed launch.",
    seedBlocks: [
      { type: "header", params: {} },
      { type: "heroHeading", params: { title: "Something new from Amie" } },
      {
        type: "statsRow",
        params: {
          items: [
            { value: "01", label: "Key proof" },
            { value: "02", label: "Key benefit" },
          ],
        },
      },
      {
        type: "productCard",
        params: {
          title: "New from Amie",
          description: "Explain the product clearly.",
        },
      },
      {
        type: "ctaButton",
        params: { label: "Meet the new arrival", url: "https://tryamie.com" },
      },
      footer,
    ],
  },
  {
    id: "newsletter",
    name: "Educational newsletter",
    description: "Teach one useful idea in a calm editorial rhythm.",
    prompt:
      "Create an educational newsletter from this seed. Fill it with a useful, credible lesson and an editorial design.",
    seedBlocks: [
      { type: "header", params: {} },
      { type: "heroHeading", params: { title: "A useful idea for this week" } },
      { type: "paragraph", params: { text: "Teach one focused lesson." } },
      {
        type: "bulletList",
        params: {
          heading: "Try this",
          items: [
            "Practical step one",
            "Practical step two",
            "Practical step three",
          ],
        },
      },
      {
        type: "quoteCallout",
        params: { quote: "Make the takeaway memorable." },
      },
      footer,
    ],
  },
  {
    id: "promo",
    name: "Promo / sale",
    description: "Lead with the offer while keeping the tone human.",
    prompt:
      "Create a polished promotional email from this seed. Make the offer clear without hype and fully style the design.",
    seedBlocks: [
      { type: "header", params: {} },
      { type: "heroHeading", params: { title: "A thoughtful offer" } },
      {
        type: "productCard",
        params: {
          title: "Featured routine",
          description: "Make the value specific.",
        },
      },
      {
        type: "ctaButton",
        params: { label: "Shop the offer", url: "https://tryamie.com" },
      },
      { type: "spacer", params: { height: 24 } },
      footer,
    ],
  },
  {
    id: "welcome",
    name: "Welcome",
    description: "Set expectations and make the first next step easy.",
    prompt:
      "Create a warm welcome email from this seed. Explain what happens next and art-direct the full email.",
    seedBlocks: [
      { type: "header", params: {} },
      { type: "heroHeading", params: { title: "Welcome to Amie" } },
      {
        type: "paragraph",
        params: {
          text: "Make the reader feel seen and explain what comes next.",
        },
      },
      {
        type: "bulletList",
        params: {
          heading: "What to expect",
          items: [
            "Useful guidance",
            "Thoughtful product education",
            "Support for your routine",
          ],
        },
      },
      {
        type: "ctaButton",
        params: { label: "Get started", url: "https://tryamie.com" },
      },
      footer,
    ],
  },
];
