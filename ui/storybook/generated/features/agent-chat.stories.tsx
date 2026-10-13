import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureOverview } from "../../support/feature-map/FeatureOverview";

const meta = {
  id: "feature-map-agent-chat",
  title: "Tasks and conversations/Agent conversations and project handoff/Overview",
  component: FeatureOverview,
  args: { area: "agent-chat" },
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureOverview>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
