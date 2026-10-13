import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureOverview } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "feature-map-navigation-preferences",
  title: "Oversight and operation/Navigation, profile, and announcements/Overview",
  component: FeatureOverview,
  args: { area: "navigation-preferences" },
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureOverview>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
