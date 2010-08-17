function! RunRubyScript(script)
   exec '!ruby '.a:script
endfunction

autocmd BufNewFile,BufRead *.rb map <D-r> :call RunRubyScript(bufname("%"))<CR>
