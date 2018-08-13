#!/bin/bash

set +x

if [ "$(uname)" == "Linux" ]; then
  install-linux.sh
fi

cd $HOME
ln -s code/vinibaggio-dotfiles/vim .vim
ln -s code/vinibaggio-dotfiles/vim/vimrc .vimrc
ln -s code/vinibaggio-dotfiles/gitconfig .gitconfig
ln -s code/vinibaggio-dotfiles/bashrc .bashrc

# Install vim packages
vim +PlugInstall +qall

# Install other packages
brew install fzf fasd hub
