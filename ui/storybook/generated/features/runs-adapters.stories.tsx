import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureOverview } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "feature-map-runs-adapters",
  title: "Agents and reusable capabilities/Runs, harnesses, and model accounts/Overview",
  component: FeatureOverview,
  args: { area: "runs-adapters" },
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureOverview>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
