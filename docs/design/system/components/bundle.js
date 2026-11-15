/* @ds-bundle: {"format": 4, "namespace": "Tally", "components": [{"name": "Button"}, {"name": "IconButton"}, {"name": "Input"}, {"name": "Textarea"}, {"name": "Select"}, {"name": "Checkbox"}, {"name": "Radio"}, {"name": "Switch"}, {"name": "SegmentedControl"}, {"name": "Slider"}, {"name": "Tooltip"}, {"name": "Popover"}, {"name": "DropdownMenu"}, {"name": "Dialog"}, {"name": "Sheet"}, {"name": "Toast"}, {"name": "Tabs"}, {"name": "Badge"}, {"name": "Kbd"}, {"name": "Avatar"}, {"name": "Skeleton"}, {"name": "Spinner"}, {"name": "ProgressBar"}, {"name": "Divider"}, {"name": "EmptyState"}, {"name": "ThreadItem"}, {"name": "UserMessage"}, {"name": "AssistantMessage"}, {"name": "ReplyMetadata"}, {"name": "BranchSwitcher"}, {"name": "Markdown"}, {"name": "CodeBlock"}, {"name": "AttachmentChip"}, {"name": "Composer"}, {"name": "CostStrip"}, {"name": "CacheStatus"}, {"name": "ThinkingIndicator"}, {"name": "CheckpointMarker"}, {"name": "ContextBar"}, {"name": "LayerRow"}, {"name": "Inspector"}, {"name": "BudgetBanner"}, {"name": "CacheBreakWarning"}, {"name": "ErrorState"}, {"name": "StatTile"}, {"name": "BarChart"}, {"name": "LineChart"}, {"name": "DataTable"}, {"name": "Legend"}, {"name": "ProviderCard"}, {"name": "ProviderForm"}, {"name": "SettingsSection"}, {"name": "SignInCard"}, {"name": "ThreadView"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  var F = React.Fragment;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var ICONS = {"plus": "<path d=\"M12 5l0 14\" /> <path d=\"M5 12l14 0\" />", "search": "<path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" /> <path d=\"M21 21l-6 -6\" />", "arrow-up": "<path d=\"M12 5l0 14\" /> <path d=\"M18 11l-6 -6\" /> <path d=\"M6 11l6 -6\" />", "player-stop-filled": "<path d=\"M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z\" />", "player-stop": "<path d=\"M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z\" />", "paperclip": "<path d=\"M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5\" />", "photo": "<path d=\"M15 8h.01\" /> <path d=\"M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z\" /> <path d=\"M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5\" /> <path d=\"M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3\" />", "chevron-left": "<path d=\"M15 6l-6 6l6 6\" />", "chevron-right": "<path d=\"M9 6l6 6l-6 6\" />", "chevron-down": "<path d=\"M6 9l6 6l6 -6\" />", "chevron-up": "<path d=\"M6 15l6 -6l6 6\" />", "copy": "<path d=\"M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z\" /> <path d=\"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1\" />", "check": "<path d=\"M5 12l5 5l10 -10\" />", "refresh": "<path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" /> <path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />", "pencil": "<path d=\"M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4\" /> <path d=\"M13.5 6.5l4 4\" />", "pin": "<path d=\"M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4\" /> <path d=\"M9 15l-4.5 4.5\" /> <path d=\"M14.5 4l5.5 5.5\" />", "git-fork": "<path d=\"M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2\" /> <path d=\"M12 12l0 4\" />", "git-branch": "<path d=\"M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M7 8l0 8\" /> <path d=\"M9 18h6a2 2 0 0 0 2 -2v-5\" /> <path d=\"M14 14l3 -3l3 3\" />", "adjustments-horizontal": "<path d=\"M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M4 6l8 0\" /> <path d=\"M16 6l4 0\" /> <path d=\"M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M4 12l2 0\" /> <path d=\"M10 12l10 0\" /> <path d=\"M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /> <path d=\"M4 18l11 0\" /> <path d=\"M19 18l1 0\" />", "layout-sidebar": "<path d=\"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z\" /> <path d=\"M9 4l0 16\" />", "layout-sidebar-right": "<path d=\"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z\" /> <path d=\"M15 4l0 16\" />", "x": "<path d=\"M18 6l-12 12\" /> <path d=\"M6 6l12 12\" />", "settings": "<path d=\"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z\" /> <path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\" />", "plug-connected": "<path d=\"M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z\" /> <path d=\"M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z\" /> <path d=\"M3 21l2.5 -2.5\" /> <path d=\"M18.5 5.5l2.5 -2.5\" /> <path d=\"M10 11l-2 2\" /> <path d=\"M13 14l-2 2\" />", "chart-bar": "<path d=\"M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\" /> <path d=\"M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\" /> <path d=\"M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\" /> <path d=\"M4 20h14\" />", "logout": "<path d=\"M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2\" /> <path d=\"M9 12h12l-3 -3\" /> <path d=\"M18 15l3 -3\" />", "alert-triangle": "<path d=\"M12 9v4\" /> <path d=\"M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z\" /> <path d=\"M12 16h.01\" />", "alert-circle": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /> <path d=\"M12 8v4\" /> <path d=\"M12 16h.01\" />", "info-circle": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /> <path d=\"M12 9h.01\" /> <path d=\"M11 12h1v4h1\" />", "circle-check": "<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /> <path d=\"M9 12l2 2l4 -4\" />", "database": "<path d=\"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0\" /> <path d=\"M4 6v6a8 3 0 0 0 16 0v-6\" /> <path d=\"M4 12v6a8 3 0 0 0 16 0v-6\" />", "clock": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /> <path d=\"M12 7v5l3 3\" />", "snowflake": "<path d=\"M10 4l2 1l2 -1\" /> <path d=\"M12 2v6.5l3 1.72\" /> <path d=\"M17.928 6.268l.134 2.232l1.866 1.232\" /> <path d=\"M20.66 7l-5.629 3.25l.01 3.458\" /> <path d=\"M19.928 14.268l-1.866 1.232l-.134 2.232\" /> <path d=\"M20.66 17l-5.629 -3.25l-2.99 1.738\" /> <path d=\"M14 20l-2 -1l-2 1\" /> <path d=\"M12 22v-6.5l-3 -1.72\" /> <path d=\"M6.072 17.732l-.134 -2.232l-1.866 -1.232\" /> <path d=\"M3.34 17l5.629 -3.25l-.01 -3.458\" /> <path d=\"M4.072 9.732l1.866 -1.232l.134 -2.232\" /> <path d=\"M3.34 7l5.629 3.25l2.99 -1.738\" />", "player-play": "<path d=\"M7 4v16l13 -8z\" />", "arrows-minimize": "<path d=\"M5 9l4 0l0 -4\" /> <path d=\"M3 3l6 6\" /> <path d=\"M5 15l4 0l0 4\" /> <path d=\"M3 21l6 -6\" /> <path d=\"M19 9l-4 0l0 -4\" /> <path d=\"M15 9l6 -6\" /> <path d=\"M19 15l-4 0l0 4\" /> <path d=\"M15 15l6 6\" />", "dots": "<path d=\"M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /> <path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /> <path d=\"M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />", "message-plus": "<path d=\"M8 9h8\" /> <path d=\"M8 13h6\" /> <path d=\"M12.01 18.594l-4.01 2.406v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v5.5\" /> <path d=\"M16 19h6\" /> <path d=\"M19 16v6\" />", "key": "<path d=\"M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z\" /> <path d=\"M15 9h.01\" />", "lock": "<path d=\"M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z\" /> <path d=\"M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\" /> <path d=\"M8 11v-4a4 4 0 1 1 8 0v4\" />", "eye": "<path d=\"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\" /> <path d=\"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6\" />", "trash": "<path d=\"M4 7l16 0\" /> <path d=\"M10 11l0 6\" /> <path d=\"M14 11l0 6\" /> <path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\" /> <path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\" />", "arrow-right": "<path d=\"M5 12l14 0\" /> <path d=\"M13 18l6 -6\" /> <path d=\"M13 6l6 6\" />", "wallet": "<path d=\"M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12\" /> <path d=\"M20 12v4h-4a2 2 0 0 1 0 -4h4\" />", "coins": "<path d=\"M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3z\" /> <path d=\"M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4\" /> <path d=\"M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598z\" /> <path d=\"M3 6v10c0 .888 .772 1.45 2 2\" /> <path d=\"M3 11c0 .888 .772 1.45 2 2\" />", "history": "<path d=\"M12 8l0 4l2 2\" /> <path d=\"M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5\" />", "sun": "<path d=\"M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\" /> <path d=\"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7\" />", "moon": "<path d=\"M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z\" />", "menu-2": "<path d=\"M4 6l16 0\" /> <path d=\"M4 12l16 0\" /> <path d=\"M4 18l16 0\" />", "external-link": "<path d=\"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6\" /> <path d=\"M11 13l9 -9\" /> <path d=\"M15 4h5v5\" />", "user": "<path d=\"M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0\" /> <path d=\"M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2\" />", "server": "<path d=\"M3 4m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z\" /> <path d=\"M3 12m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z\" /> <path d=\"M7 8l0 .01\" /> <path d=\"M7 16l0 .01\" />", "arrow-down": "<path d=\"M12 5l0 14\" /> <path d=\"M18 13l-6 6\" /> <path d=\"M6 13l6 6\" />", "bolt": "<path d=\"M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11\" />", "gauge": "<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /> <path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /> <path d=\"M13.41 10.59l2.59 -2.59\" /> <path d=\"M7 12a5 5 0 0 1 5 -5\" />", "file-text": "<path d=\"M14 3v4a1 1 0 0 0 1 1h4\" /> <path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" /> <path d=\"M9 9l1 0\" /> <path d=\"M9 13l6 0\" /> <path d=\"M9 17l6 0\" />", "cpu": "<path d=\"M5 5m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z\" /> <path d=\"M9 9h6v6h-6z\" /> <path d=\"M3 10h2\" /> <path d=\"M3 14h2\" /> <path d=\"M10 3v2\" /> <path d=\"M14 3v2\" /> <path d=\"M21 10h-2\" /> <path d=\"M21 14h-2\" /> <path d=\"M14 21v-2\" /> <path d=\"M10 21v-2\" />", "circle-dashed": "<path d=\"M8.56 3.69a9 9 0 0 0 -2.92 1.95\" /> <path d=\"M3.69 8.56a9 9 0 0 0 -.69 3.44\" /> <path d=\"M3.69 15.44a9 9 0 0 0 1.95 2.92\" /> <path d=\"M8.56 20.31a9 9 0 0 0 3.44 .69\" /> <path d=\"M15.44 20.31a9 9 0 0 0 2.92 -1.95\" /> <path d=\"M20.31 15.44a9 9 0 0 0 .69 -3.44\" /> <path d=\"M20.31 8.56a9 9 0 0 0 -1.95 -2.92\" /> <path d=\"M15.44 3.69a9 9 0 0 0 -3.44 -.69\" />", "brand-github": "<path d=\"M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5\" />"};

  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  var hid = 0;
  function useHoloId() { var r = useRef(null); if (!r.current) r.current = "tc-holo-" + (++hid); return r.current; }

  /* ---------- Foundations ---------- */
  function Icon(p) {
    var s = p.size || 16;
    var body = ICONS[p.name] || "";
    var filled = /-filled$/.test(p.name);
    return h("svg", {
      className: cx("tc-icon", p.className), width: s, height: s, viewBox: "0 0 24 24", "aria-hidden": p.label ? undefined : true, role: p.label ? "img" : undefined, "aria-label": p.label,
      fill: filled ? "currentColor" : "none", stroke: filled ? "none" : "currentColor", strokeWidth: p.stroke || 1.5, strokeLinecap: "round", strokeLinejoin: "round", style: p.style,
      dangerouslySetInnerHTML: { __html: body }
    });
  }

  function HoloGradient(p) {
    return h("linearGradient", { id: p.id, gradientUnits: "userSpaceOnUse", x1: p.x1 || 0, y1: p.y1 || 0, x2: p.x2 == null ? 100 : p.x2, y2: p.y2 || 0 },
      h("stop", { offset: "0", style: { stopColor: "var(--holo-cyan)" } }),
      h("stop", { offset: "0.34", style: { stopColor: "var(--holo-violet)" } }),
      h("stop", { offset: "0.68", style: { stopColor: "var(--holo-pink)" } }),
      h("stop", { offset: "1", style: { stopColor: "var(--holo-amber)" } }),
      p.animate ? h("animateTransform", { attributeName: "gradientTransform", type: "translate", values: "0 0;" + (p.x2 || 100) * 0.3 + " 0;0 0", dur: "9s", repeatCount: "indefinite" }) : null
    );
  }

  /* The refreshed mark: a holo-outlined rounded square, a lowercase t built from a tally stroke and a slashed crossbar, ruler ticks along the base. */
  function Logo(p) {
    var id = useHoloId();
    var s = p.size || 32;
    var draw = p.draw;
    return h("span", { className: cx("tc-logo", draw && "tc-draw"), style: { display: "inline-flex", alignItems: "center", gap: Math.round(s / 3.2) } },
      h("svg", { width: s, height: s, viewBox: "0 0 48 48", fill: "none", role: "img", "aria-label": "tally.chat" },
        h("defs", null, h(HoloGradient, { id: id, x1: 4, y1: 4, x2: 44, y2: 44 })),
        h("rect", { x: 3.5, y: 3.5, width: 41, height: 41, rx: 12, stroke: "url(#" + id + ")", strokeWidth: 1.5, pathLength: draw ? 1 : undefined }),
        h("path", { d: "M22 11v21.5c0 3 1.8 4.5 4.5 4.5H30", stroke: "var(--foreground)", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round", pathLength: draw ? 1 : undefined }),
        h("path", { d: "M14.5 21.5L31.5 16.5", stroke: "var(--accent)", strokeWidth: 3, strokeLinecap: "round", pathLength: draw ? 1 : undefined }),
        h("path", { d: "M12 39v2.5M16 39v2.5M32 39v2.5M36 39v2.5", stroke: "url(#" + id + ")", strokeWidth: 1, strokeLinecap: "round", opacity: 0.8, pathLength: draw ? 1 : undefined })
      ),
      p.wordmark ? h("span", { style: { font: "600 " + Math.round(s * 0.56) + "px/1 var(--font-sans)", letterSpacing: "-0.03em" } }, "tally", h("span", { style: { color: "var(--foreground-subtle)", fontWeight: 400 } }, ".chat")) : null
    );
  }

  function Panel(p) {
    return h("div", { className: "tc tc-panel", "data-theme": p.theme, style: p.style },
      p.label === false ? null : h("div", { className: "tc-panel-label" }, p.theme === "dark" ? "Dark" : "Light"),
      typeof p.children === "function" ? p.children(p.theme) : p.children);
  }
  /* Renders its children once per theme. side: true puts the themes side by side. */
  function Stage(p) {
    var themes = p.themes || ["light", "dark"];
    return h("div", { className: cx("tc-stage", p.side && "tc-stage-row") },
      themes.map(function (t) { return h(Panel, { key: t, theme: t, style: p.panelStyle, label: p.label }, p.children); }));
  }

  function RollingNumber(p) {
    var str = String(p.value);
    var digits = "0123456789";
    return h("span", { className: "tc-roll", "aria-label": p.label || str, role: "text", style: p.style },
      str.split("").map(function (ch, i) {
        var idx = digits.indexOf(ch);
        if (idx < 0) return h("span", { key: i, "aria-hidden": true }, ch);
        return h("span", { key: i, className: "tc-roll-d", "aria-hidden": true },
          h("span", { style: { transform: "translateY(" + (-idx * 1.5) + "em)" } },
            digits.split("").map(function (d) { return h("b", { key: d }, d); })));
      }));
  }

  /* ---------- Primitives ---------- */
  function Spinner(p) {
    var id = useHoloId(); var s = p.size || 16;
    return h("span", { className: "tc-spinner", role: "status", "aria-label": p.label || "Loading", style: { width: s, height: s, color: "var(--foreground-subtle)" } },
      h("svg", { width: s, height: s, viewBox: "0 0 16 16", fill: "none" },
        h("defs", null, h(HoloGradient, { id: id, x1: 0, y1: 0, x2: 16, y2: 16 })),
        h("path", { d: "M8 0.75A7.25 7.25 0 0 1 15.25 8", stroke: "url(#" + id + ")", strokeWidth: 1.5, strokeLinecap: "round" })));
  }

  function Button(p) {
    var v = p.variant || "secondary", size = p.size || "md";
    var holo = p.holo != null ? p.holo : v === "primary";
    var rest = {};
    for (var k in p) if (["variant", "size", "holo", "icon", "iconRight", "loading", "children", "className", "iconOnly", "focus"].indexOf(k) < 0) rest[k] = p[k];
    var isz = size === "lg" ? 18 : size === "sm" ? 14 : 16;
    return h("button", Object.assign({
      type: "button",
      className: cx("tc-btn", "tc-btn-" + v, size !== "md" && "tc-btn-" + size, p.iconOnly && "tc-btn-icon", holo && "holo-border holo-sweep", p.focus && "tc-force-focus", p.className),
      "data-loading": p.loading ? "true" : undefined, "aria-busy": p.loading ? true : undefined,
      disabled: p.disabled || p.loading,
      style: p.focus ? Object.assign({ outline: "2px solid var(--ring)", outlineOffset: 2 }, p.style) : p.style
    }, rest),
      p.loading ? h(Spinner, { size: isz - 2 }) : p.icon ? h(Icon, { name: p.icon, size: isz }) : null,
      p.children != null ? h("span", { className: "tc-btn-label" }, p.children) : null,
      p.iconRight ? h(Icon, { name: p.iconRight, size: isz }) : null);
  }
  function IconButton(p) { return h(Button, Object.assign({ variant: "ghost", iconOnly: true, "aria-label": p.label, title: p.label }, p, { children: null })); }

  function Field(p) {
    return h("label", { className: "tc-field", style: p.style },
      p.label ? h("span", { className: "tc-field-label" }, p.label) : null,
      p.children,
      p.error ? h("span", { className: "tc-field-error" }, h(Icon, { name: "alert-circle", size: 14 }), p.error) : p.help ? h("span", { className: "tc-field-help" }, p.help) : null);
  }
  function Input(p) {
    var inp = h("input", { className: cx("tc-input", p.mono && "tc-input-mono"), placeholder: p.placeholder, defaultValue: p.value, type: p.type || "text", disabled: p.disabled, "aria-invalid": p.error ? true : undefined, "data-focus": p.focus ? "true" : undefined, readOnly: p.readOnly });
    return p.label || p.help || p.error ? h(Field, { label: p.label, help: p.help, error: p.error, style: p.style }, inp) : inp;
  }
  function Textarea(p) {
    var t = h("textarea", { className: "tc-input", placeholder: p.placeholder, defaultValue: p.value, rows: p.rows || 3, disabled: p.disabled, "aria-invalid": p.error ? true : undefined, "data-focus": p.focus ? "true" : undefined });
    return h(Field, { label: p.label, help: p.help, error: p.error, style: p.style }, t);
  }
  function Select(p) {
    var b = h("button", { type: "button", className: "tc-input tc-select", "aria-haspopup": "listbox", "data-focus": p.focus ? "true" : undefined, "aria-disabled": p.disabled ? "true" : undefined, "aria-invalid": p.error ? true : undefined },
      h("span", { className: p.value ? null : "tc-ph", style: { display: "flex", alignItems: "center", gap: 8 } }, p.icon ? h(Icon, { name: p.icon }) : null, p.value || p.placeholder || "Select"),
      h(Icon, { name: "chevron-down", size: 14, style: { color: "var(--foreground-subtle)" } }));
    return p.label ? h(Field, { label: p.label, help: p.help, error: p.error, style: p.style }, b) : b;
  }
  function Checkbox(p) {
    var st = useState(!!p.checked), on = st[0];
    return h("span", { className: "tc-check", role: "checkbox", tabIndex: p.disabled ? -1 : 0, "aria-checked": on, "aria-disabled": p.disabled ? "true" : undefined, onClick: function () { if (!p.disabled) st[1](!on); } },
      h("span", { className: "tc-box", "data-checked": on ? "true" : "false" },
        h("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none" }, h("path", { d: "M2.5 6.2l2.3 2.3 4.7-5", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", pathLength: 20 }))),
      p.label);
  }
  function Radio(p) {
    return h("span", { className: "tc-check", role: "radio", tabIndex: p.disabled ? -1 : 0, "aria-checked": !!p.checked, "aria-disabled": p.disabled ? "true" : undefined, onClick: p.onSelect },
      h("span", { className: "tc-box tc-radio", "data-checked": p.checked ? "true" : "false" }), p.label);
  }
  function RadioGroup(p) {
    var st = useState(p.value || p.options[0]);
    return h("div", { role: "radiogroup", className: "tc-col", style: { gap: 10 } }, p.options.map(function (o) {
      return h(Radio, { key: o, label: o, checked: st[0] === o, disabled: p.disabled && p.disabled.indexOf(o) >= 0, onSelect: function () { st[1](o); } });
    }));
  }
  function Switch(p) {
    var st = useState(!!p.checked), on = st[0];
    return h("span", { className: "tc-check", role: "switch", tabIndex: p.disabled ? -1 : 0, "aria-checked": on, "aria-disabled": p.disabled ? "true" : undefined, onClick: function () { if (!p.disabled) st[1](!on); } },
      h("span", { className: "tc-switch", "data-checked": on ? "true" : "false" }), p.label);
  }
  function SegmentedControl(p) {
    var st = useState(p.value || p.options[0].value || p.options[0]);
    return h("div", { className: cx("tc-seg", p.size === "sm" && "tc-seg-sm"), role: "group", "aria-label": p.label },
      p.options.map(function (o) {
        var val = o.value || o, lab = o.label || o;
        return h("button", { key: val, type: "button", className: "tc-seg-item", "aria-pressed": st[0] === val, onClick: function () { st[1](val); } }, o.icon ? h(Icon, { name: o.icon, size: 14 }) : null, lab);
      }));
  }
  function Slider(p) {
    var id = useHoloId();
    var st = useState(p.value == null ? 40 : p.value), v = st[0];
    var steps = p.steps || 0;
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 6, minWidth: 200, opacity: p.disabled ? 0.45 : 1 } },
      p.label ? h("div", { style: { display: "flex", justifyContent: "space-between", font: "500 13px/18px var(--font-sans)" } }, h("span", null, p.label), h("span", { className: "tc-num", style: { color: "var(--foreground-muted)", fontSize: 12 } }, p.format ? p.format(v) : v)) : null,
      h("div", { className: "tc-slider", role: "slider", "aria-valuenow": v, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": p.label, tabIndex: 0,
        onKeyDown: function (e) { if (e.key === "ArrowRight") st[1](Math.min(100, v + 5)); if (e.key === "ArrowLeft") st[1](Math.max(0, v - 5)); } },
        h("div", { className: "tc-slider-track" }),
        h("div", { className: "tc-slider-fill holo-fill", style: { width: v + "%" } }),
        h("div", { className: "tc-slider-thumb", "data-focus": p.focus ? "true" : undefined, style: { left: v + "%" } }),
        steps ? h("div", { className: "tc-slider-ticks" }, Array.from({ length: steps + 1 }).map(function (_, i) { return h("i", { key: i }); })) : null));
  }
  function Kbd(p) { return h("kbd", { className: "tc-kbd" }, p.children); }
  function Tooltip(p) {
    return h("span", { style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 } },
      h("span", { className: "tc-tooltip", role: "tooltip" }, p.content, p.kbd ? h(Kbd, null, p.kbd) : null),
      p.children);
  }
  function Popover(p) {
    return h("div", { className: cx("tc-float tc-popover", p.live && "holo-border holo-subtle"), role: "dialog", "aria-label": p.title, style: p.style },
      p.title ? h("div", { style: { font: "600 14px/20px var(--font-sans)", marginBottom: 6 } }, p.title) : null, p.children);
  }
  function Menu(p) {
    return h("div", { className: "tc-float tc-menu", role: "menu", style: p.style }, p.items.map(function (it, i) {
      if (it === "-") return h("div", { key: i, className: "tc-menu-sep", role: "separator" });
      if (it.label && it.heading) return h("div", { key: i, className: "tc-menu-label" }, it.label);
      return h("div", { key: i, className: "tc-menu-item", role: "menuitem", "data-highlighted": it.active ? "true" : undefined, "data-danger": it.danger ? "true" : undefined },
        it.icon ? h(Icon, { name: it.icon, size: 15 }) : null, h("span", null, it.label),
        it.check ? h(Icon, { name: "check", size: 14, style: { marginLeft: "auto", color: "var(--accent)" } }) : it.hint ? h("span", { className: "tc-menu-hint" }, it.hint) : null);
    }));
  }
  function Dialog(p) {
    return h("div", { className: "tc-dialog-wrap", style: p.wrapStyle },
      h("div", { className: "tc-dialog holo-border holo-subtle", role: "dialog", "aria-modal": true, "aria-labelledby": "dlg" },
        h("div", { style: { display: "flex", alignItems: "flex-start", gap: 12 } },
          p.icon ? h("span", { style: { width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--" + (p.tone || "warning") + "-soft)", color: "var(--" + (p.tone || "warning") + ")", flex: "none" } }, h(Icon, { name: p.icon, size: 18 })) : null,
          h("div", { style: { flex: 1 } }, h("h3", { id: "dlg" }, p.title), h("p", null, p.description))),
        p.children,
        h("div", { className: "tc-dialog-actions" }, p.actions)));
  }
  function Sheet(p) {
    var bottom = p.side === "bottom";
    return h("div", { style: { position: "relative", height: p.height || 260, background: "var(--scrim)", borderRadius: "var(--radius-card)", overflow: "hidden", display: "flex", flexDirection: bottom ? "column" : "row" } },
      h("div", { className: cx("tc-sheet", bottom && "tc-sheet-bottom"), role: "dialog", "aria-label": p.title },
        bottom ? h("div", { className: "tc-sheet-grip" }) : null,
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } }, h("span", { style: { font: "600 15px/22px var(--font-sans)" } }, p.title), h(IconButton, { icon: "x", label: "Close", size: "sm" })),
        p.children));
  }
  function Toast(p) {
    var tone = p.tone || "success";
    var icon = { success: "circle-check", danger: "alert-circle", warning: "alert-triangle", info: "info-circle" }[tone];
    return h("div", { className: "tc-float tc-toast", role: "status" },
      h(Icon, { name: icon, size: 18, style: { color: "var(--" + tone + ")", marginTop: 1 } }),
      h("div", { style: { flex: 1 } }, h("div", { className: "tc-toast-title" }, p.title), p.body ? h("div", { className: "tc-toast-body" }, p.body) : null),
      p.action ? h(Button, { size: "sm", variant: "ghost" }, p.action) : h(IconButton, { icon: "x", label: "Dismiss", size: "sm" }));
  }
  function Tabs(p) {
    var st = useState(p.value || p.tabs[0].value || p.tabs[0]);
    return h("div", { className: "tc-tabs", role: "tablist" }, p.tabs.map(function (t) {
      var val = t.value || t;
      return h("button", { key: val, type: "button", role: "tab", className: "tc-tab", "aria-selected": st[0] === val, onClick: function () { st[1](val); } }, t.label || t, t.count != null ? h("span", { className: "tc-num" }, t.count) : null);
    }));
  }
  function Badge(p) {
    return h("span", { className: cx("tc-badge", p.dot && "tc-badge-dot", p.tone === "live" && "holo-border holo-shimmer"), "data-tone": p.tone }, p.icon ? h(Icon, { name: p.icon, size: 12 }) : null, p.children);
  }
  function Avatar(p) {
    return h("span", { className: cx("tc-avatar", p.size && "tc-avatar-" + p.size, p.live && "holo-border holo-vivid"), "aria-label": p.name, title: p.name },
      p.icon ? h(Icon, { name: p.icon, size: p.size === "sm" ? 12 : 15 }) : (p.name || "?").split(" ").map(function (s) { return s[0]; }).join("").slice(0, 2).toUpperCase());
  }
  function Skeleton(p) { return h("div", { className: "tc-skeleton", style: { width: p.width || "100%", height: p.height || 12, borderRadius: p.radius } }); }
  function ProgressBar(p) {
    var tone = p.value >= 100 ? "paused" : p.value >= 80 ? "near" : null;
    return h("div", { className: cx("tc-progress", p.indeterminate && "tc-progress-indeterminate"), "data-tone": p.tone || tone, role: "progressbar", "aria-valuenow": p.indeterminate ? undefined : p.value, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": p.label, style: p.style },
      h("i", { className: (p.tone || tone) ? null : "holo-fill", style: { width: Math.min(100, p.value || 0) + "%" } }));
  }
  function Divider(p) {
    if (p.label) return h("div", { className: "tc-divider-label", role: "separator" }, p.label);
    return h("hr", { className: cx("tc-divider", p.holo && "tc-divider-holo") });
  }
  function EmptyState(p) {
    var id = useHoloId();
    return h("div", { className: "tc-empty" },
      h("div", { className: "tc-grid-bg" }),
      h("div", { style: { position: "relative" } },
        h("svg", { className: "tc-draw", width: 56, height: 40, viewBox: "0 0 56 40", fill: "none", "aria-hidden": true },
          h("defs", null, h(HoloGradient, { id: id, x1: 0, y1: 0, x2: 56, y2: 40 })),
          h("path", { d: "M8 6v28M16 6v28M24 6v28M32 6v28", stroke: "url(#" + id + ")", strokeWidth: 1.5, strokeLinecap: "round", pathLength: 1 }),
          h("path", { d: "M4 28L38 10", stroke: "url(#" + id + ")", strokeWidth: 1.5, strokeLinecap: "round", pathLength: 1, style: { animationDelay: "0.5s" } }),
          h("path", { d: "M44 34h8", stroke: "var(--border-strong)", strokeWidth: 1, strokeLinecap: "round", pathLength: 1 })),
        h("h4", null, p.title), h("p", null, p.description), p.action));
  }

  /* ---------- Chat ---------- */
  function ThreadItem(p) {
    var id = useHoloId();
    return h("div", { className: cx("tc-thread", p.active && "holo-border holo-subtle"), "data-active": p.active ? "true" : undefined, "data-unread": p.unread ? "true" : undefined, role: "link", tabIndex: 0, "aria-current": p.active ? "page" : undefined },
      p.streaming ? h("svg", { width: 14, height: 2, className: "tc-thread-live", "aria-label": "Streaming" }, h("defs", null, h(HoloGradient, { id: id, x2: 14, animate: true })), h("rect", { width: 14, height: 2, rx: 1, fill: "url(#" + id + ")" })) : null,
      h("span", { className: "tc-thread-title" }, p.title),
      p.unread ? h("span", { className: "tc-thread-dot", "aria-label": "Unread" }) : p.cost ? h("span", { className: "tc-thread-meta" }, p.cost) : null);
  }
  function Sidebar(p) {
    return h("aside", { className: "tc-sidebar", "aria-label": "Threads" },
      h("div", { className: "tc-sidebar-top" }, h(Logo, { size: 22, wordmark: true }), h("span", { style: { flex: 1 } }), h(IconButton, { icon: "message-plus", label: "New thread", size: "sm" })),
      h("div", { className: "tc-input tc-sidebar-search" }, h(Icon, { name: "search", size: 14, style: { color: "var(--foreground-subtle)" } }), h("span", { className: "tc-ph", style: { flex: 1 } }, "Search threads"), h(Kbd, null, "⌘K")),
      (p.groups || []).map(function (g) {
        return h(F, { key: g.label }, h("div", { className: "tc-sidebar-group" }, g.label), g.items.map(function (t) { return h(ThreadItem, Object.assign({ key: t.title }, t)); }));
      }),
      h("div", { className: "tc-sidebar-foot" },
        h(Avatar, { name: "Ruben N", size: "sm" }), h("span", { style: { font: "500 13px/1 var(--font-sans)", flex: 1 } }, "Today ", h("span", { className: "tc-num", style: { color: "var(--foreground-muted)", fontSize: 12 } }, "$0.84 / $5")),
        h(IconButton, { icon: "settings", label: "Settings", size: "sm" })));
  }
  function UserMessage(p) {
    return h("div", { className: "tc-user" },
      p.attachments ? h("div", { className: "tc-row", style: { justifyContent: "flex-end" } }, p.attachments) : null,
      h("div", { className: "tc-user-bubble" }, p.children),
      h("div", { className: "tc-msg-actions" }, p.branch ? h(BranchSwitcher, p.branch) : null, h(IconButton, { icon: "pencil", label: "Edit (forks a branch)", size: "sm" }), h(IconButton, { icon: "copy", label: "Copy", size: "sm" })));
  }
  function MessageActions(p) {
    return h("div", { className: "tc-msg-actions", role: "toolbar", "aria-label": "Message actions" },
      h(IconButton, { icon: "copy", label: "Copy", size: "sm" }),
      h(IconButton, { icon: "refresh", label: "Retry", size: "sm" }),
      h(IconButton, { icon: "git-fork", label: "Fork from here", size: "sm" }),
      h(IconButton, { icon: "pin", label: "Pin", size: "sm" }));
  }
  function AssistantMessage(p) {
    var id = useHoloId();
    return h("div", { className: "tc-assistant", "data-streaming": p.streaming ? "true" : undefined, style: { position: "relative" } },
      p.streaming ? h("svg", { className: "tc-stream-rail", width: 2, height: "100%", preserveAspectRatio: "none", viewBox: "0 0 2 100", "aria-hidden": true },
        h("defs", null, h(HoloGradient, { id: id, x1: 0, y1: 0, x2: 0, y2: 100 })), h("rect", { width: 2, height: 100, rx: 1, fill: "url(#" + id + ")" })) : null,
      p.thinking ? h(ThinkingIndicator, p.thinking) : null,
      h("div", { className: "tc-prose" }, p.children),
      p.truncated ? h("div", null, h(Button, { size: "sm", variant: "outline", icon: "player-play" }, "Continue"), h("span", { className: "tc-num", style: { marginLeft: 10, fontSize: 12, color: "var(--foreground-muted)" } }, "Hit the 4k output limit")) : null,
      p.streaming ? null : h("div", { className: "tc-msg-foot" },
        p.branch ? h(BranchSwitcher, p.branch) : null,
        p.meta ? h(ReplyMeta, p.meta) : null,
        h("span", { style: { flex: 1 } }),
        h(MessageActions)));
  }
  function ReplyMeta(p) {
    return h("button", { type: "button", className: "tc-meta", "aria-haspopup": "dialog", "aria-label": "Cost breakdown" },
      h("span", { className: "model" }, p.model), p.effort ? h("span", null, "(" + p.effort + ")") : null,
      h("span", { className: "sep" }, "·"), h("span", null, p.cost),
      h("span", { className: "sep" }, "·"), h("span", null, p.input + " in ", h("span", { className: "cached" }, "(" + p.cached + " cached)")),
      h("span", { className: "sep" }, "·"), h("span", null, p.output + " out"));
  }
  function CostBreakdown(p) {
    var rows = p.rows || [
      { label: "Cache read", state: "cached", tokens: "10.8k", price: "$0.0032" },
      { label: "Cache write", state: "write", tokens: "1.2k", price: "$0.0045" },
      { label: "Fresh input", state: "fresh", tokens: "412", price: "$0.0012" },
      { label: "Output", tokens: "340", price: "$0.0051" }
    ];
    return h("div", { className: "tc-float tc-breakdown", role: "dialog", "aria-label": "Cost breakdown" },
      h("div", { className: "tc-overline", style: { marginBottom: 8 } }, "This reply"),
      rows.map(function (r) {
        return h("div", { key: r.label, className: "tc-breakdown-row" },
          h("span", null, r.state ? h("i", { className: "tc-swatch", "data-state": r.state }) : h("i", { className: "tc-swatch", style: { background: "var(--foreground-muted)" } }), r.label),
          h("span", { className: "r" }, r.tokens), h("span", { className: "r", style: { color: "var(--foreground)" } }, r.price));
      }),
      h("div", { className: "tc-breakdown-total" }, h("span", { style: { fontFamily: "var(--font-sans)", fontWeight: 600 } }, "Total"), h("span", null, p.total || "$0.0140")),
      h("div", { style: { marginTop: 8, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--foreground-muted)" } }, "Without cache: ", h("span", { className: "tc-num" }, p.uncached || "$0.0412"), " · saved ", h("span", { className: "tc-num", style: { color: "var(--savings-positive)" } }, p.saved || "+$0.0272")));
  }
  function BranchSwitcher(p) {
    var st = useState(p.index || 1), dir = useState(null);
    var i = st[0], n = p.count || 3;
    function go(d) { var nx = i + d; if (nx < 1 || nx > n) return; dir[1](d > 0 ? "next" : "prev"); st[1](nx); }
    return h("span", { className: "tc-branch", role: "group", "aria-label": "Branch " + i + " of " + n },
      h("button", { type: "button", "aria-label": "Previous branch", disabled: i <= 1, onClick: function () { go(-1); } }, h(Icon, { name: "chevron-left", size: 14 })),
      h("span", { className: "tc-branch-count", "data-dir": dir[0] }, h("span", { key: i }, i + "/" + n)),
      h("button", { type: "button", "aria-label": "Next branch", disabled: i >= n, onClick: function () { go(1); } }, h(Icon, { name: "chevron-right", size: 14 })));
  }

  var KW = /^(const|let|var|function|return|await|async|if|else|for|while|import|from|export|new|type|interface|extends|of|in|as|true|false|null|undefined|def|class)$/;
  function highlight(code) {
    var out = [], re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|([{}()\[\];,.:=<>+\-*/!?&|]+)|(\s+)|(.)/gm, m, k = 0;
    while ((m = re.exec(code))) {
      var t = m[0], cls = null;
      if (m[1]) cls = "tk-c"; else if (m[2]) cls = "tk-s"; else if (m[3]) cls = "tk-n";
      else if (m[4]) { if (KW.test(t)) cls = "tk-k"; else if (/^[A-Z]/.test(t)) cls = "tk-t"; else if (code[re.lastIndex] === "(") cls = "tk-f"; }
      else if (m[5]) cls = "tk-p";
      out.push(cls ? h("span", { key: k++, className: cls }, t) : t);
    }
    return out;
  }
  function CodeBlock(p) {
    var st = useState(false);
    var lines = p.code.replace(/\n$/, "").split("\n");
    return h("div", { className: "tc-code" },
      h("div", { className: "tc-code-head" },
        h("span", { className: "tc-code-lang" }, h(Icon, { name: "file-text", size: 13 }), p.lang || "text", p.filename ? h("span", { style: { color: "var(--foreground-muted)" } }, p.filename) : null),
        h(Button, { size: "sm", variant: "ghost", icon: st[0] ? "check" : "copy", onClick: function () { st[1](true); setTimeout(function () { st[1](false); }, 1600); }, "aria-live": "polite" }, st[0] ? "Copied" : "Copy")),
      h("pre", null, h("code", null, lines.map(function (l, i) { return h("span", { key: i, className: p.lineNumbers === false ? null : "ln" }, l ? highlight(l) : " "); }))));
  }
  function Prose(p) { return h("div", { className: "tc-prose" }, p.children); }
  function AttachmentChip(p) {
    return h("span", { className: "tc-attach", "data-state": p.error ? "error" : undefined },
      h("span", { className: "tc-attach-thumb" }, p.loading ? h(Spinner, { size: 14 }) : h(Icon, { name: p.kind === "file" ? "file-text" : "photo", size: 16 })),
      h("span", null, p.name, h("small", null, p.error || p.meta)),
      p.removable === false ? null : h(IconButton, { icon: "x", label: "Remove " + p.name, size: "sm", style: { marginLeft: 2 } }));
  }
  function EffortBars(p) {
    var n = { low: 1, medium: 2, high: 3, max: 4 }[p.level] || 2;
    return h("span", { className: "tc-effort", "aria-hidden": true }, [5, 7, 9, 12].map(function (hh, i) { return h("i", { key: i, "data-on": i < n ? "true" : "false", style: { height: hh } }); }));
  }
  function Composer(p) {
    var focus = p.focus, disabled = p.disabled;
    return h("div", { className: "tc-composer-col" },
      p.banner || null,
      h("div", { className: cx("tc-composer", focus && "holo-border holo-shimmer holo-vivid"), "data-focus": focus ? "true" : undefined, "data-disabled": disabled ? "true" : undefined, style: p.banner ? { marginTop: 8 } : null },
        p.attachments ? h("div", { className: "tc-composer-attach" }, p.attachments) : null,
        h("div", { className: "tc-composer-input", role: "textbox", "aria-multiline": true, "aria-disabled": disabled ? true : undefined, "aria-label": "Message" },
          p.value ? h(F, null, p.value, focus ? h("span", { className: "tc-caret", style: { width: 1.5, background: "var(--foreground)" } }) : null) : h("span", { className: "ph" }, disabled ? "Paused by daily budget" : "Message Sonnet 5.5")),
        h("div", { className: "tc-composer-bar" },
          h(IconButton, { icon: "paperclip", label: "Attach image", size: "sm", disabled: disabled }),
          h("button", { type: "button", className: "tc-picker", disabled: disabled }, h(Icon, { name: "cpu", size: 14 }), p.model || "Sonnet 5.5", h(Icon, { name: "chevron-down", size: 12 })),
          h("button", { type: "button", className: "tc-picker", disabled: disabled, "aria-label": "Effort " + (p.effort || "low") }, h(EffortBars, { level: p.effort || "low" }), p.effort || "low"),
          h(SegmentedControl, { size: "sm", label: "Output mode", value: p.mode || "normal", options: ["quick", "normal", "long"] }),
          h("span", { className: "grow" }),
          p.streaming ? h(Button, { variant: "secondary", iconOnly: true, icon: "player-stop-filled", "aria-label": "Stop", className: "tc-send" })
            : h(Button, { variant: "primary", iconOnly: true, icon: "arrow-up", "aria-label": "Send", className: "tc-send", disabled: disabled || !p.value, holo: !!p.value && !disabled }))),
      p.strip === false ? null : h(CostStrip, p.cost || {}));
  }
  function CostStrip(p) {
    return h("div", { className: "tc-cost", "aria-live": "polite" },
      h("span", { className: "tc-cost-left" },
        h("strong", null, "~$", h(RollingNumber, { value: p.next || "0.004" })), h("span", null, "next"),
        h("span", { className: "sep" }, "·"),
        h(CacheStatus, { state: p.cache || "warm", remaining: p.remaining, compact: true }),
        h("span", { className: "sep" }, "·"),
        h("span", { className: p.cache === "cold" ? null : "hit" }, (p.hit || "87") + "% hit")),
      p.warning ? h("span", { className: "warn" }, p.warning) : h("span", null, h(Kbd, null, "↵"), " send  ", h(Kbd, null, "⇧↵"), " newline"));
  }
  function CacheStatus(p) {
    var id = useHoloId();
    var state = p.state || "warm";
    var remaining = p.remaining == null ? (state === "warm" ? 0.82 : state === "cooling" ? 0.16 : 0) : p.remaining;
    var C = 2 * Math.PI * 5.25;
    var label = { warm: "cache warm", cooling: "cache cooling", cold: "cache cold" }[state];
    var ring = state === "cold" ? null : h("circle", { className: "tc-cache-ring", cx: 7, cy: 7, r: 5.25, stroke: state === "warm" ? "url(#" + id + ")" : "var(--cache-cooling)", strokeWidth: 1.25, fill: "none", strokeDasharray: C, strokeDashoffset: C * (1 - remaining), strokeLinecap: "round" });
    var svg = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true },
      h("defs", null, h(HoloGradient, { id: id, x1: 0, y1: 0, x2: 14, y2: 14 })),
      h("circle", { cx: 7, cy: 7, r: 5.25, stroke: "var(--border)", strokeWidth: 1.25, fill: "none" }),
      ring,
      h("circle", { className: "tc-cache-dot", cx: 7, cy: 7, r: 2.25, fill: "var(--cache-" + state + ")" }));
    if (p.compact) return h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, role: "status", "aria-label": label }, svg, h("span", null, label));
    return h("span", { className: cx("tc-cache", state === "warm" && "holo-border holo-subtle"), "data-state": state, role: "status", "aria-label": label + (p.time ? ", " + p.time + " left" : "") },
      svg, label, p.time ? h("span", { className: "tc-num" }, p.time) : null);
  }
  function ThinkingIndicator(p) {
    var id = useHoloId();
    return h("div", { className: "tc-thinking", role: "status", "aria-live": "polite" },
      h("span", { className: "tc-thinking-lines", "aria-hidden": true }, [0, 1, 2, 3, 4].map(function (i) { return h("i", { key: i, className: "holo-fill" }); })),
      h("span", null, p.label || "Thinking"), p.elapsed ? h("span", { className: "tc-num" }, p.elapsed) : null);
  }
  function CheckpointMarker(p) {
    return h("div", { className: "tc-checkpoint", role: "separator", "aria-label": p.label },
      h("span", { className: "tc-checkpoint-pill" }, h(Icon, { name: "arrows-minimize", size: 13 }), p.label || "Turns 1-14 condensed", h("span", { className: "tc-num" }, p.detail || "38.2k → 2.1k tokens")));
  }

  /* ---------- Inspector ---------- */
  function ContextBar(p) {
    var layers = p.layers, total = p.max || 200000;
    var used = layers.reduce(function (a, l) { return a + l.tokens; }, 0);
    function fmt(n) { return n >= 1000 ? Math.round(n / 1000) + "k" : String(n); }
    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        h("span", { className: "tc-overline" }, "Context window"),
        h("span", { className: "tc-num", style: { fontSize: 12, color: "var(--foreground-muted)" } }, h("span", { style: { color: "var(--foreground)" } }, (used / 1000).toFixed(1) + "k"), " / " + fmt(total))),
      h("div", { className: "tc-ctx" },
        h("div", { className: "tc-ctx-ruler", "aria-hidden": true }, [0, 0.25, 0.5, 0.75, 1].map(function (f) { return h("span", { key: f, style: { left: f * 100 + "%" } }, fmt(total * f * (p.zoom || 1))); })),
        h("div", { className: "tc-ctx-minor", "aria-hidden": true }),
        h("div", { className: "tc-ctx-bar", role: "img", "aria-label": layers.map(function (l) { return l.name + " " + l.tokens + " tokens " + l.state; }).join(", ") },
          layers.map(function (l, i) {
            return h("div", { key: i, className: cx("tc-ctx-seg", l.selected && "holo-border holo-vivid"), "data-state": l.state, "data-selected": l.selected ? "true" : undefined, style: { width: (l.tokens / (total * (p.zoom || 1))) * 100 + "%" }, title: l.name });
          }))),
      h("div", { className: "tc-ctx-legend" },
        h("span", null, h("i", { className: "tc-swatch", "data-state": "cached" }), "cached"),
        h("span", null, h("i", { className: "tc-swatch", "data-state": "write" }), "to be written"),
        h("span", null, h("i", { className: "tc-swatch", "data-state": "fresh" }), "fresh")));
  }
  function LayerRow(p) {
    var tone = { cached: "cached", write: "write", fresh: "fresh" }[p.state];
    var lab = { cached: "cached", write: "to write", fresh: "fresh" }[p.state];
    return h("div", { className: cx("tc-layer", p.selected && "holo-border holo-default"), "data-selected": p.selected ? "true" : undefined, role: "row", tabIndex: 0 },
      h("span", { className: "tc-layer-name" }, h(Icon, { name: p.icon || "file-text", size: 14, style: { color: "var(--foreground-subtle)" } }), p.name),
      h(Badge, { tone: tone }, lab),
      h("span", { className: "tc-num" }, p.tokens),
      h("span", { className: "tc-num", style: { color: "var(--foreground)" } }, p.price));
  }
  var DEMO_LAYERS = [
    { name: "System prompt", tokens: 3200, state: "cached", icon: "settings", t: "3.2k", price: "$0.0010" },
    { name: "Checkpoint: turns 1-14", tokens: 2100, state: "cached", icon: "arrows-minimize", t: "2.1k", price: "$0.0006" },
    { name: "Turns 15-22", tokens: 5500, state: "cached", icon: "history", t: "5.5k", price: "$0.0017" },
    { name: "Turn 23 (last reply)", tokens: 1200, state: "write", icon: "message-plus", t: "1.2k", price: "$0.0045", selected: true },
    { name: "Next message", tokens: 412, state: "fresh", icon: "pencil", t: "412", price: "$0.0012" }
  ];
  function Inspector(p) {
    var layers = p.layers || DEMO_LAYERS;
    return h("aside", { className: "tc-inspector", "aria-label": "Inspector" },
      h("div", { className: "tc-inspector-head" }, h("span", { className: "tc-overline", style: { flex: 1 } }, "Inspector"), h(CacheStatus, { state: p.cache || "warm", time: p.cache === "cooling" ? "0:48" : "4:12" }), h(IconButton, { icon: "layout-sidebar-right", label: "Close inspector", size: "sm" })),
      h("div", { className: "tc-inspector-sec" }, h(ContextBar, { layers: layers, max: p.max || 200000, zoom: p.zoom || 0.1 })),
      h("div", { className: "tc-inspector-sec" },
        h("div", { className: "tc-overline", style: { marginBottom: 6 } }, "Layers"),
        layers.map(function (l, i) { return h(LayerRow, { key: i, name: l.name, state: l.state, tokens: l.t, price: l.price, icon: l.icon, selected: l.selected }); })),
      h("div", { className: "tc-inspector-sec" },
        h("div", { className: "tc-overline" }, "Thread total"),
        h("div", { className: "tc-total" }, h("span", { className: "tc-num" }, "$0.2184"), h("span", { className: "tc-num", style: { fontSize: 12, color: "var(--foreground-muted)" } }, "23 turns")),
        h("div", { className: "tc-kv" }, h("span", null, "Hit rate"), h("span", { className: "tc-num", style: { color: "var(--cached)" } }, "87%")),
        h("div", { className: "tc-kv" }, h("span", null, "Cache upkeep"), h("span", { className: "tc-num" }, "$0.0121")),
        h("div", { className: "tc-kv" }, h("span", null, "Saved vs no cache"), h("span", { className: "tc-num pos" }, "+$0.4310"))),
      h("div", { className: "tc-inspector-sec", style: { borderBottom: 0 } },
        h(Button, { variant: "outline", icon: "arrows-minimize", style: { width: "100%" } }, "Condense now"),
        h("div", { className: "tc-field-help", style: { marginTop: 8, textAlign: "center" } }, "Turns 15-22 → about 1.4k tokens, ", h("span", { className: "tc-num" }, "~$0.006"), " once")));
  }

  /* ---------- Feedback ---------- */
  function BudgetBanner(p) {
    var paused = p.state === "paused";
    return h("div", { className: "tc-banner", "data-tone": paused ? "paused" : "near", role: paused ? "alert" : "status" },
      h(Icon, { name: paused ? "lock" : "alert-triangle", size: 16, className: "tc-banner-icon" }),
      h("span", { className: "tc-banner-text" }, paused ? h(F, null, h("strong", null, "Sending paused. "), "You hit today's ", h("span", { className: "tc-num" }, "$5.00"), " budget.") : h(F, null, h("strong", null, "80% of today's budget used. "), h("span", { className: "tc-num" }, "$4.02 / $5.00"))),
      paused ? h(Button, { size: "sm", variant: "secondary" }, "Override for today") : h(Button, { size: "sm", variant: "ghost" }, "Adjust"));
  }
  function CacheBreakDialog(p) {
    return h(Dialog, { icon: "alert-triangle", tone: "warning", title: "Editing this message breaks the cache", description: "Everything after turn 9 gets re-sent at full price. Continuing the thread keeps the cache.",
      actions: h(F, null, h(Button, { variant: "ghost" }, "Cancel"), h(Button, { variant: "secondary" }, "Continue instead"), h(Button, { variant: "primary" }, "Edit anyway")) },
      h("div", { className: "tc-compare" },
        h("div", null, h("small", null, "Continue"), h("span", { className: "tc-num" }, "~$0.004")),
        h("div", { className: "holo-border holo-subtle", style: { borderColor: "transparent" } }, h("small", null, "Edit and fork"), h("span", { className: "tc-num" }, "~$0.084"), h("span", { className: "tc-num", style: { fontSize: 12, color: "var(--warning)", marginLeft: 6 } }, "+$0.08"))));
  }
  function ErrorState(p) {
    return h("div", { className: "tc-error", role: "alert" },
      h(Icon, { name: "alert-circle", size: 18, className: "tc-error-icon" }),
      h("div", { style: { flex: 1 } },
        h("div", { className: "tc-error-title" }, p.title || "Reply failed"),
        h("div", { className: "tc-error-body" }, p.body || h(F, null, "The provider returned ", h("code", null, "529 overloaded"), ". Nothing was charged.")),
        h("div", { className: "tc-row", style: { marginTop: 10, gap: 8 } }, h(Button, { size: "sm", variant: "secondary", icon: "refresh" }, p.action || "Retry"), p.secondary ? h(Button, { size: "sm", variant: "ghost" }, p.secondary) : null)));
  }

  /* ---------- Data ---------- */
  function StatTile(p) {
    var ref = useRef(null);
    useEffect(function () {
      if (!p.tilt || !ref.current) return;
      var el = ref.current;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      function mv(e) { var r = el.getBoundingClientRect(); var x = (e.clientX - r.left) / r.width - 0.5; el.style.setProperty("--holo-angle", (115 + x * 50) + "deg"); }
      function lv() { el.style.setProperty("--holo-angle", "115deg"); }
      el.addEventListener("pointermove", mv); el.addEventListener("pointerleave", lv);
      return function () { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerleave", lv); };
    }, [p.tilt]);
    return h("div", { ref: ref, className: cx("tc-tile", p.highlight && "holo-border holo-default") },
      h("div", { className: "tc-overline" }, p.label),
      h("div", { className: cx("tc-tile-value", p.hero && "holo-text") }, p.value),
      p.delta ? h("span", { className: "tc-tile-delta", "data-dir": p.dir }, h(Icon, { name: p.dir === "neg" ? "arrow-down" : "arrow-up", size: 12 }), p.delta) : null);
  }
  var MODELS = [{ name: "Sonnet 5.5", key: "chart-1" }, { name: "Opus 5.5", key: "chart-3" }, { name: "GPT-5.2", key: "chart-2" }, { name: "Llama (Ollama)", key: "chart-4" }];
  var SPEND = [[0.42, 0.1, 0.05, 0], [0.38, 0.22, 0.04, 0], [0.61, 0.0, 0.12, 0], [0.2, 0.08, 0.0, 0], [0.55, 0.34, 0.06, 0], [0.7, 0.1, 0.18, 0], [0.31, 0.05, 0.02, 0],
    [0.48, 0.4, 0.07, 0], [0.66, 0.12, 0.09, 0], [0.29, 0.0, 0.0, 0], [0.52, 0.26, 0.11, 0], [0.83, 0.18, 0.04, 0], [0.4, 0.09, 0.15, 0], [0.58, 0.31, 0.03, 0]];
  function Legend(p) {
    var items = p.items || MODELS;
    return h("div", { className: "tc-legend" }, items.map(function (m) {
      return h("span", { key: m.name }, h("i", { className: "tc-swatch", style: { background: "var(--" + m.key + ")" } }), m.name, m.value ? h("b", null, m.value) : null);
    }));
  }
  function BarChart(p) {
    var data = p.data || SPEND, W = p.width || 560, H = p.height || 180, pad = { l: 34, b: 22, t: 8, r: 4 };
    var max = 1.2, bw = (W - pad.l - pad.r) / data.length;
    var y = function (v) { return H - pad.b - (v / max) * (H - pad.b - pad.t); };
    return h("div", null,
      h("svg", { className: "tc-chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Spend by day, stacked by model" },
        [0, 0.4, 0.8, 1.2].map(function (v) { return h("g", { key: v }, h("line", { className: "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }), h("text", { x: pad.l - 6, y: y(v) + 3, textAnchor: "end" }, "$" + v.toFixed(1))); }),
        data.map(function (d, i) {
          var acc = 0, x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
          return h("g", { key: i },
            d.map(function (v, j) { if (!v) return null; var y0 = y(acc), y1 = y(acc + v); acc += v; return h("rect", { key: j, className: "bar", x: x, y: y1, width: w, height: Math.max(0, y0 - y1 - 1), rx: j === 0 ? 0 : 1.5, fill: "var(--" + MODELS[j].key + ")", style: { animationDelay: i * 25 + "ms" } }); }),
            h("line", { className: "tick", x1: x + w / 2, x2: x + w / 2, y1: H - pad.b, y2: H - pad.b + 3 }),
            i % 2 === 0 ? h("text", { x: x + w / 2, y: H - 6, textAnchor: "middle" }, String(i + 1)) : null);
        }),
        h("line", { className: "axis", x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b })),
      p.legend === false ? null : h("div", { style: { marginTop: 10 } }, h(Legend, null)));
  }
  function LineChart(p) {
    var id = useHoloId();
    var data = p.data || [71, 74, 69, 78, 82, 80, 85, 83, 88, 86, 90, 87, 89, 91], W = p.width || 560, H = p.height || 150, pad = { l: 34, b: 20, t: 8, r: 6 };
    var x = function (i) { return pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r); };
    var y = function (v) { return H - pad.b - ((v - 50) / 50) * (H - pad.b - pad.t); };
    var d = data.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var last = data.length - 1;
    return h("svg", { className: "tc-chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Cache hit rate, last 14 days" },
      h("defs", null, h(HoloGradient, { id: id, x1: pad.l, x2: W - pad.r })),
      [50, 75, 100].map(function (v) { return h("g", { key: v }, h("line", { className: "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }), h("text", { x: pad.l - 6, y: y(v) + 3, textAnchor: "end" }, v + "%")); }),
      data.map(function (_, i) { return h("line", { key: i, className: "tick", x1: x(i), x2: x(i), y1: H - pad.b, y2: H - pad.b + 3 }); }),
      h("line", { className: "axis", x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }),
      h("path", { className: "line", d: d, stroke: "url(#" + id + ")", pathLength: 1 }),
      h("circle", { cx: x(last), cy: y(data[last]), r: 3.5, fill: "var(--surface)", stroke: "var(--cached)", strokeWidth: 1.5 }),
      h("text", { x: x(last) - 8, y: y(data[last]) - 9, textAnchor: "end", style: { fill: "var(--foreground)" } }, data[last] + "%"));
  }
  function DataTable(p) {
    var rows = p.rows || [
      { model: "Sonnet 5.5", key: "chart-1", turns: 412, tokens: "4.81M", hit: "89%", spend: "$7.12", share: 0.57 },
      { model: "Opus 5.5", key: "chart-3", turns: 58, tokens: "0.92M", hit: "84%", spend: "$3.40", share: 0.27 },
      { model: "GPT-5.2", key: "chart-2", turns: 96, tokens: "1.10M", hit: "71%", spend: "$1.96", share: 0.16 },
      { model: "Llama (Ollama)", key: "chart-4", turns: 33, tokens: "0.21M", hit: "n/a", spend: "$0.00", share: 0 }
    ];
    return h("table", { className: "tc-table" },
      h("thead", null, h("tr", null, h("th", null, "Model"), h("th", { className: "n" }, "Turns"), h("th", { className: "n" }, "Tokens"), h("th", { className: "n" }, "Hit rate"), h("th", { className: "n" }, "Spend"), h("th", { className: "bar-cell" }, "Share"))),
      h("tbody", null, rows.map(function (r) {
        return h("tr", { key: r.model },
          h("td", null, h("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } }, h("i", { className: "tc-swatch", style: { background: "var(--" + r.key + ")" } }), r.model)),
          h("td", { className: "n" }, r.turns), h("td", { className: "n" }, r.tokens), h("td", { className: "n" }, r.hit), h("td", { className: "n", style: { color: "var(--foreground)" } }, r.spend),
          h("td", { className: "bar-cell" }, h("div", { className: "tc-mini-bar" }, h("i", { style: { width: r.share * 100 + "%", background: "var(--" + r.key + ")" } }))));
      })));
  }

  /* ---------- Pages ---------- */
  function ProviderCard(p) {
    var status = p.status || "connected";
    return h("div", { className: cx("tc-card tc-provider", p.selected && "holo-border holo-default") },
      h("div", { className: "tc-provider-head" },
        h("span", { className: "tc-provider-logo" }, p.mono || p.name.slice(0, 2)),
        h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { className: "tc-provider-name" }, p.name), h("div", { className: "tc-provider-url" }, p.url)),
        status === "connected" ? h(Badge, { tone: "success", icon: "circle-check" }, "Connected") : status === "error" ? h(Badge, { tone: "danger", icon: "alert-circle" }, "Can't connect") : h(Badge, { icon: "circle-dashed" }, "Not tested")),
      status === "error" ? h(ErrorState, { title: "Connection failed", body: h(F, null, h("code", null, "401 invalid_api_key"), ". Check the key and base URL."), action: "Test again", secondary: "Edit" }) :
        h(F, null,
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, font: "400 12px/16px var(--font-mono)", color: "var(--foreground-muted)" } }, h(Icon, { name: "lock", size: 13 }), "sk-ant-•••• 4f2a", h("span", { style: { flex: 1 } }), "encrypted"),
          h("div", { className: "tc-provider-models" }, (p.models || []).map(function (m) { return h(Badge, { key: m }, m); }))));
  }
  function ProviderForm(p) {
    return h("div", { className: "tc-card", style: { padding: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 440 } },
      h("div", { style: { font: "600 15px/22px var(--font-sans)" } }, "Add provider"),
      h(Select, { label: "Type", value: "OpenAI-compatible", icon: "server" }),
      h(Input, { label: "Base URL", value: "https://openrouter.ai/api/v1", mono: true }),
      h(Input, { label: "API key", type: "password", value: "sk-or-v1-0000000000", mono: true, help: "Stored encrypted on your server. Never sent to the browser again." }),
      h("div", { className: "tc-row", style: { justifyContent: "flex-end" } }, h(Button, { variant: "ghost" }, "Cancel"), h(Button, { variant: "secondary", icon: "plug-connected" }, "Test"), h(Button, { variant: "primary" }, "Save")));
  }
  function SettingsSection(p) {
    return h("section", { className: "tc-card", style: { padding: "6px 20px" } },
      h("div", { className: "tc-settings" },
        h("div", { className: "tc-settings-row" }, h("div", null, h("h5", null, "Daily budget"), h("p", null, "Soft warning at 80%, pause at 100%.")), h("div", { className: "tc-input tc-input-mono", style: { width: 120 } }, "$ 5.00")),
        h("div", { className: "tc-settings-row" }, h("div", null, h("h5", null, "Keep cache warm"), h("p", null, "Refresh the cache in the background while you read. Costs ", h("span", { className: "tc-num" }, "~$0.001"), " per refresh.")), h(Switch, { checked: true })),
        h("div", { className: "tc-settings-row" }, h("div", null, h("h5", null, "Condense at"), h("p", null, "Summarize older turns when the context passes this size.")), h(Slider, { value: 60, steps: 4, format: function (v) { return Math.round(v * 2) + "k"; } })),
        h("div", { className: "tc-settings-row" }, h("div", null, h("h5", null, "Side-job model"), h("p", null, "Used for titles and condensing.")), h(Select, { value: "Haiku 5.5", style: { width: 160 } }))));
  }
  function SignInCard(p) {
    return h("div", { className: "tc-signin-wrap" },
      h("div", { className: "tc-grid-bg" }),
      h("div", { className: "tc-card tc-signin holo-border holo-subtle" },
        h(Logo, { size: 36, draw: p.draw }),
        h("h2", null, "Sign in to tally"), h("p", null, "Chat with any model. See what every turn costs."),
        h("div", { className: "tc-col", style: { gap: 14 } },
          h(Input, { label: "Password", type: "password", value: p.error ? "hunter2" : "", placeholder: "Your instance password", error: p.error ? "That password didn't match." : null, focus: !p.error }),
          h(Button, { variant: "primary", size: "lg", style: { width: "100%" }, loading: p.loading }, p.loading ? "Signing in" : "Sign in"))));
  }

  /* ---------- Composition ---------- */
  var SAMPLE_CODE = "// Lay out the request so the provider can reuse the prefix\nexport async function send(thread: Thread, next: string) {\n  const prefix = [thread.system, thread.checkpoint, ...thread.turns]\n  const req = withCacheBreakpoints(prefix, { ttl: 300 })\n  return provider.stream({ ...req, messages: [...req.messages, next] })\n}";
  function ThreadView(p) {
    var scroller = useRef(null);
    useEffect(function () { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, []);
    var groups = [
      { label: "Today", items: [{ title: "Cache-aware request layout", active: true, streaming: false, cost: "$0.22" }, { title: "Refactor billing webhooks", streaming: true }, { title: "Tencent TKE pod restarts", unread: true }] },
      { label: "Yesterday", items: [{ title: "Postgres index for usage table", cost: "$0.09" }, { title: "PWA install prompt copy", cost: "$0.01" }] },
      { label: "Previous 7 days", items: [{ title: "Geist vs Inter for numbers", cost: "$0.04" }, { title: "Ollama on a home server", cost: "$0.00" }] }
    ];
    return h("div", { className: "tc tc-shell", "data-inspector": p.inspector === false ? "false" : "true" },
      h(Sidebar, { groups: groups }),
      h("main", { className: "tc-main" },
        h("header", { className: "tc-header" },
          h("span", { className: "tc-header-title" }, "Cache-aware request layout"),
          h(Badge, null, "23 turns"),
          h(IconButton, { icon: "git-branch", label: "Branches", size: "sm" }),
          h(IconButton, { icon: "layout-sidebar-right", label: "Toggle inspector", size: "sm" })),
        h("div", { className: "tc-messages", ref: scroller },
          h("div", { className: "tc-col-msg" },
            h(CheckpointMarker, null),
            h(UserMessage, { branch: { index: 2, count: 3 } }, "How should I order the request so the cache survives edits to the system prompt?"),
            h(AssistantMessage, { meta: { model: "Sonnet 5.5", effort: "low", cost: "$0.0043", input: "12.4k", cached: "87%", output: "340" } },
              h("p", null, "Put everything that rarely changes first, and mark the end of that prefix as a cache breakpoint. The provider reuses the longest matching prefix, so ", h("strong", null, "order is the whole trick"), "."),
              h(CodeBlock, { lang: "ts", filename: "send.ts", code: SAMPLE_CODE }),
              h("p", null, "Editing the system prompt still invalidates everything after it. Keep it stable and move volatile instructions into the latest turn.")),
            h(UserMessage, null, "And while I'm reading?"),
            h(AssistantMessage, { streaming: true }, h("p", null, "Keepalive sends a tiny request before the 5 minute expiry, so the next real message still hits. It costs a fraction of a write")))),
        h("div", { className: "tc-composer-dock" }, h(Composer, { focus: true, value: "Show the keepalive timing as a diagram", cost: { next: "0.004", cache: "warm", hit: "87" } }))),
      p.inspector === false ? null : h(Inspector, null));
  }

  var api = {
    Icon: Icon, Logo: Logo, Stage: Stage, Panel: Panel, HoloGradient: HoloGradient, RollingNumber: RollingNumber, useHoloId: useHoloId,
    Button: Button, IconButton: IconButton, Spinner: Spinner, Field: Field, Input: Input, Textarea: Textarea, Select: Select,
    Checkbox: Checkbox, Radio: Radio, RadioGroup: RadioGroup, Switch: Switch, SegmentedControl: SegmentedControl, Slider: Slider,
    Tooltip: Tooltip, Popover: Popover, Menu: Menu, Dialog: Dialog, Sheet: Sheet, Toast: Toast, Tabs: Tabs,
    Badge: Badge, Kbd: Kbd, Avatar: Avatar, Skeleton: Skeleton, ProgressBar: ProgressBar, Divider: Divider, EmptyState: EmptyState,
    ThreadItem: ThreadItem, Sidebar: Sidebar, UserMessage: UserMessage, AssistantMessage: AssistantMessage, MessageActions: MessageActions,
    ReplyMeta: ReplyMeta, CostBreakdown: CostBreakdown, BranchSwitcher: BranchSwitcher, Prose: Prose, CodeBlock: CodeBlock,
    AttachmentChip: AttachmentChip, Composer: Composer, CostStrip: CostStrip, CacheStatus: CacheStatus, ThinkingIndicator: ThinkingIndicator,
    CheckpointMarker: CheckpointMarker, ContextBar: ContextBar, LayerRow: LayerRow, Inspector: Inspector,
    BudgetBanner: BudgetBanner, CacheBreakDialog: CacheBreakDialog, ErrorState: ErrorState,
    StatTile: StatTile, BarChart: BarChart, LineChart: LineChart, DataTable: DataTable, Legend: Legend,
    ProviderCard: ProviderCard, ProviderForm: ProviderForm, SettingsSection: SettingsSection, SignInCard: SignInCard, ThreadView: ThreadView,
    DEMO_LAYERS: DEMO_LAYERS,
    Markdown: Prose, ReplyMetadata: ReplyMeta, CacheBreakWarning: CacheBreakDialog, DropdownMenu: Menu
  };
  window.Tally = Object.assign(window.Tally || {}, api);
})();
