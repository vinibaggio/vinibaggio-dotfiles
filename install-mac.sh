#!/bin/bash

sudo defaults write -g ApplePressAndHoldEnabled -bool false
defaults write com.jetbrains.intellij ApplePressAndHoldEnabled -bool false
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
defaults write com.apple.screencapture disable-shadow -bool true


# Shitty font stuff, see https://tonsky.me/blog/monitors/
defaults write -g CGFontRenderingFontSmoothingDisabled -bool NO

defaults write com.microsoft.VSCode CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.EH CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.NP CGFontRenderingFontSmoothingDisabled 0

cd $HOME/code/vinibaggio-dotfiles/brewfiles && brew bundle

# Install Mac Apple Store specific stuff
echo "Please install the following in the Mac App Store then press enter"
echo "Todoist"
echo "Xcode"
read -e "..."
# Todoist
