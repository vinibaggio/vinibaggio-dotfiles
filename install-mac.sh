#!/bin/bash

sudo defaults write -g ApplePressAndHoldEnabled -bool false
defaults write com.jetbrains.intellij ApplePressAndHoldEnabled -bool false
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
defaults write com.apple.screencapture disable-shadow -bool true
defaults write com.apple.finder CreateDesktop false

# Disable bullshit autocomplete

defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false
defaults write NSGlobalDomain NSAutomaticTextCompletionEnabled -bool false


# Shitty font stuff, see https://tonsky.me/blog/monitors/
defaults write -g CGFontRenderingFontSmoothingDisabled -bool NO

defaults write com.microsoft.VSCode CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.EH CGFontRenderingFontSmoothingDisabled 0
defaults write com.microsoft.VSCode.helper.NP CGFontRenderingFontSmoothingDisabled 0


# Iterm config
defaults write com.googlecode.iterm2 PrefsCustomFolder -string "~/code/vinibaggio-dotfiles/iterm2-config"
defaults write com.googlecode.iterm2 LoadPrefsFromCustomFolder -bool true
