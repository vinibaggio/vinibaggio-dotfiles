function! RunRubyScript(script)
   exec '!ruby '.a:script
endfunction

nnoremap <D-r> :call RunRubyScript(bufname("%"))<CR>
