#!/bin/bash

set +x
set +e

echo "Running OS specific install..."

if [ "$(uname)" == "Linux" ]; then
  ./install-linux.sh
elif [ "$(uname)" == "Darwin" ]; then
  ./install-mac.sh
fi

echo "Linking config files..."
pushd $HOME
test ! -e "$HOME/.vim" && ln -s code/vinibaggio-dotfiles/vim .vim
test ! -e "$HOME/.vimrc" && ln -s code/vinibaggio-dotfiles/vim/vimrc .vimrc
test ! -e "$HOME/.gitconfig" && ln -s code/vinibaggio-dotfiles/gitconfig .gitconfig
test ! -e "$HOME/.bashrc" && ln -s code/vinibaggio-dotfiles/bashrc .bashrc
test ! -e "$HOME/.zshrc" && ln -s code/vinibaggio-dotfiles/zshrc .zshrc
popd

echo "Installing vim plugins..."
vim +PlugInstall +qall

echo "Running general bundle"
brew bundle

echo "Installing personal repo things if exists..."
if [ -d "$HOME/code/personal-dotfiles" ]; then
  pushd "$HOME/code/personal-dotfiles"
  ./install.sh
  popd
fi

echo "Installing private repo things if exists..."
if [ -d "$HOME/code/vinibaggio-private" ]; then
  pushd "$HOME/code/vinibaggio-private" 
  ./install.sh
  popd
fi

echo "Setup complete."
