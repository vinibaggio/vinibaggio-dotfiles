#!/bin/bash

defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
defaults write com.apple.screencapture disable-shadow -bool true

# Mavericks font crap
defaults write com.microsoft.VSCode CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.EH CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.NP CGFontRenderingFontSmoothingDisabled 0
brew bundle --file brewfiles/Brewfile
