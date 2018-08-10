#!/bin/bash

# setup the basics
sudo apt-get install build-essential curl file git
sudo add-apt-repository ppa:jonathonf/vim

# setup linuxbrew

sh -c "$(curl -fsSL https://raw.githubusercontent.com/Linuxbrew/install/master/install.sh)"

echo 'export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"' >>~/.profile
echo 'export MANPATH="/home/linuxbrew/.linuxbrew/share/man:$MANPATH"' >>~/.profile
echo 'export INFOPATH="/home/linuxbrew/.linuxbrew/share/info:$INFOPATH"' >>~/.profile
echo '. $HOME/.bashrc' >>~/.profile
