import { describe, expect, it } from "vitest";
import {
  displayTypeCommand,
  extraDisplayActionCommand,
  extraDisplayInputCommand,
} from "./extra-displays.js";

const layout = { display: ":20", displayNumber: 20 };

describe("displayTypeCommand", () => {
  it("types ASCII directly with xdotool", () => {
    expect(displayTypeCommand(":20", "hello world")).toBe("DISPLAY=:20 xdotool type 'hello world'");
  });

  it("routes non-ASCII text through the clipboard and Ctrl+V", () => {
    const command = displayTypeCommand(":20", "แคท อารียา");
    expect(command).toContain("xclip -selection clipboard -input");
    expect(command).toContain("xdotool key --clearmodifiers ctrl+v");
    // The text rides as base64 so Thai survives shell quoting untouched.
    expect(command).toContain(Buffer.from("แคท อารียา", "utf8").toString("base64"));
  });
});

describe("action/input builders", () => {
  it("uses the clipboard route for non-ASCII typing and the direct path for ASCII", () => {
    expect(extraDisplayActionCommand(layout, { kind: "clipboard", text: "สวัสดี" })).toContain(
      "xclip",
    );
    expect(extraDisplayInputCommand(layout, { kind: "clipboard", text: "สวัสดี" })).toContain(
      "xclip",
    );
    expect(extraDisplayActionCommand(layout, { kind: "clipboard", text: "plain text" })).toContain(
      "xdotool type",
    );
  });
});
