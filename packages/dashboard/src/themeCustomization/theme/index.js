import Palette from "../palette";

// Compatibility wrapper for callers that still import the legacy theme selector.
const Theme = () => Palette("light").palette;

export default Theme;
