import React from "react";

// Identifies which "bucket" of the workspace a LayoutBuilder belongs
// to so drop handlers on grid cells can distinguish a same-container
// swap from a cross-container move (sidebar ↔ main dashboard). Wrap
// the sidebar's LayoutBuilder with value "sidebar"; everything else
// defaults to "main". Its own module so a widget (WidgetFactory) can read
// where it is without importing the grid.
export const WorkspaceScopeContext = React.createContext("main");
