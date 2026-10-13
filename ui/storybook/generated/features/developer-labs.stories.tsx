import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureOverview } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "feature-map-developer-labs",
  title: "Contributor surfaces/Developer previews and diagnostic labs/Overview",
  component: FeatureOverview,
  args: { area: "developer-labs" },
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureOverview>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
