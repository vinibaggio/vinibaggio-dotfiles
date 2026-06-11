#!/bin/bash

sudo defaults write -g ApplePressAndHoldEnabled -bool false
defaults write com.jetbrains.intellij ApplePressAndHoldEnabled -bool false
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
defaults write com.mitchellh.ghostty ApplePressAndHoldEnabled -bool false

# Key repeat
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15
defaults write com.apple.screencapture disable-shadow -bool true
defaults write com.apple.finder CreateDesktop false

# Disable bullshit autocomplete

defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false
defaults write NSGlobalDomain NSAutomaticTextCompletionEnabled -bool false


# Font smoothing, see https://tonsky.me/blog/monitors/
defaults write com.microsoft.VSCode CGFontRenderingFontSmoothingDisabled 0
