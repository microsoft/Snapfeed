import type { Preview } from "@storybook/html";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    options: {
      storySort: {
        order: ["Snapfeed"],
      },
    },
  },
};

export default preview;
