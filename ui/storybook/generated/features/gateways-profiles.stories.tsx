import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureOverview } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "feature-map-gateways-profiles",
  title: "Apps, channels, and extensions/Tool gateways and access profiles/Overview",
  component: FeatureOverview,
  args: { area: "gateways-profiles" },
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureOverview>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
