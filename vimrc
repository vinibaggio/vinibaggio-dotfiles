set autoindent
syntax on

" Display line numbers and information ruler
set number
set ruler

" Navigate through buffers without vim whinings on unsaved buffers
set hidden

set hlsearch
set smarttab

" Stop annoying bells
set vb

" Swap files: off you go
set noswapfile

" No folding! I hate folding!
set nofoldenable

" Load pathogen
call pathogen#runtime_append_all_bundles()

" As seen on Vimcasts, expand path for the current file
let mapleader=','
map <leader>ew :e <C-R>=expand("%:p:h") . "/" <CR>
map <leader>es :sp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>ev :vsp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>et :tabe <C-R>=expand("%:p:h") . "/" <CR>

map <leader>s :set spell<CR>
map <leader>S :set nospell<CR>
" Expand Rails-specific commands
" map <leader>is :RSintegrationtest 
" map <leader>c :Rcontroller

" As seen on Vimcasts
if has("autocmd")
  " File type detection
  filetype on
  filetype plugin indent on

  " Default settings
  set ts=2 sts=2 sw=2 expandtab
  " Styles depending on file type
  autocmd FileType ruby setlocal ts=2 sts=2 sw=2 expandtab
  autocmd FileType python setlocal ts=4 sts=4 sw=4 expandtab
  autocmd FileType javascript setlocal ts=4 sts=4 sw=4 expandtab

  " Treat different file types as one we know. Example:
  " autocmd BufNewFile,BufRead *.rss,*.atom setfiletype xml
  
  " Automatically remove whitespaces while saving files
  autocmd BufWritePre *.snippet,*.yml,*.rb,*.html,*.css,*.erb,*.haml :call <SID>StripTrailingWhitespaces()
endif


" As seen on Vimcasts
nnoremap <silent> <F5> :call <SID>StripTrailingWhitespaces()<CR>
function! <SID>StripTrailingWhitespaces()
  " Preparation: save last search and cursor position.
  let _s=@/
  let l = line(".")
  let c = col(".")
  " Do the business
  %s/\s\+$//e
  " Clean up: restore previous search history and cursor position
  let @/=_s
  call cursor(l,c)
endfunction


" As seen on Vimcasts
" Use window movement with Ctrl-h instead of Ctrl-w h and so on
map <C-h> <C-w>h
map <C-j> <C-w>j
map <C-k> <C-w>k
map <C-l> <C-w>l

" As seen on Vimcasts, with a few changes by me

map <D-Right> gt
map <D-Left> gT
map <D-1> 1gt
map <D-2> 2gt
map <D-3> 3gt
map <D-4> 4gt
map <D-5> 5gt
map <D-6> 6gt
map <D-7> 7gt
map <D-8> 8gt
map <D-9> 9gt
map <D-0> :tablast<CR>

" I always type W instead of w
cab W w
cab Q q
" Map Shift-Tab to autocomplete
" imap <S-Tab> <C-n>

" Map hashrocket as Textmate
imap <C-L> <Space>=><Space>

" I hate Y behavior, isn't natural for me
" so Y now copies until the end of the line
nnoremap Y y$

" I don't want the original snippmate snippets
let g:snippets_dir='~/.vim/snippets'
source ~/.vim/snippets/support_functions.vim

"Adding a statusline 
set statusline=
set statusline+=%<\                           " cut at start
set statusline+=%2*[%n%H%M%R%W]%*\            " buffer number, and flags
set statusline+=%-40f\                        " relative path
set statusline+=%#warningmsg#                 " Syntastic
set statusline+=%{SyntasticStatuslineFlag()}  "   "
set statusline+=%*                            "   "
set statusline+=%=                            " seperate between right- and left-aligned
set statusline+=%1*%y%*%*\                    " file type
set statusline+=%10((%l/%L)%)\                " line and column
set statusline+=%P                            " percentage of file
" Show it!
set laststatus=2


" formatting text
set formatprg=par
set textwidth=80
set formatoptions+=t

" TAB idents, STab unindents (thanks hashrocket!)
vnoremap <silent> <TAB> >gv
vnoremap <silent> <S-TAB> <gv

" Command r and Command R
autocmd User Rails nnoremap <buffer> <D-r> :<C-U>Rake<CR>
autocmd User Rails nnoremap <buffer> <D-R> :<C-U>.Rake<CR>

nnoremap \] :<C-U>CommandT<CR>

" Commant T ignore list
set wildignore+=*/public/uploads/*
set wildignore+=*/db/sphinx/*
