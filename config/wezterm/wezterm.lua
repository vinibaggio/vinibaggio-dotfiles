-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices

-- For example, changing the color scheme:
-- config.color_scheme = 'AdventureTime'

config.font = wezterm.font("JetBrains Mono")
config.font_size = 18

config.initial_cols = 90
config.initial_rows = 30

-- and finally, return the configuration to wezterm
return config
