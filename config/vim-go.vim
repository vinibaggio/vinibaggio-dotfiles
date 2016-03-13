let $GOPATH = $HOME."/code/golang:".$HOME."/code/mono/go/src/"
let $GOROOT = "/usr/local/Cellar/go/1.5.2/libexec"
let $PATH = $PATH.":".$HOME."/code/golang/bin/"
let g:go_bin_path = $HOME."/code/golang/bin"
let g:go_fmt_command = "goimports"
au FileType go nmap <leader>r <Plug>(go-run)
au FileType go nmap <leader>b <Plug>(go-build)
au FileType go nmap <leader>t <Plug>(go-test)
au FileType go nmap <leader>c <Plug>(go-coverage)
