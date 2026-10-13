import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureMapIndex } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "overview-storybook-guide",
  title: "Overview/Storybook Guide",
  component: FeatureMapIndex,
  parameters: { docs: { description: { component: "Feature-based navigation from the downstream catalog, with separate product, component, and fixture classifications. Story links come from this build's index." } } },
} satisfies Meta<typeof FeatureMapIndex>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CoverageGuide: Story = {};
