#!/bin/bash

ln -s vinibaggio-profile/bashrc ~/.profile

# setup the basics
sudo apt-get install build-essential curl file git autoconf
sudo add-apt-repository ppa:jonathonf/vim

# Mosh with forward agent patch
sudo dpkg -i vinibaggio-profile/bin/mosh_1.3.2-2_amd64.deb

# setup linuxbrew

sh -c "$(curl -fsSL https://raw.githubusercontent.com/Linuxbrew/install/master/install.sh)"


# Install Docker
# sudo apt-get install \
#     apt-transport-https \
#     ca-certificates \
#     curl \
#     software-properties-common
#
# curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
#
# sudo add-apt-repository \
#    "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
#    $(lsb_release -cs) \
#    stable"
#
# sudo apt update
#
# sudo apt install docker-ce
