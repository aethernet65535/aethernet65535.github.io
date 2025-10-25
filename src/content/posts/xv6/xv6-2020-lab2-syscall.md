---
title: XV6-2020: LAB2-SYSCALL
published: 2025-06-06
description: "初步理解系统调用"
image: "./lab2.jpg"
tags: ["xv6"]
category: OS
draft: false
---

## 前言
首先，我们得先切换为其他分支。
```sh
git fetch
git checkout syscall
make clean
```

## system call tracing (moderate)
我们需要修改的文件有这些：
```tree
|-- user/
|-- |-- user.h
|-- |-- usys.pl
|-- kernel/
|-- |-- proc.h
|-- |-- syscall.c
|-- |-- syscall.h
|-- |-- sysproc.c
```
#### user.h
我们得在这文件里添加这行：
```C
int trace(int);
```
#### usys.pl
这里也是添加这行就可以了，我们做的这俩操作主要是要让用户态能使用这两个系统调用。
```C
entry("trace");
```

#### syscall.h
添加这行，这个叫系统调用号，最好是顺序，不顺序可能没法跑？（你可以试试）
```C
#define SYS_trace 22
```
#### syscall.c
添加这行：
```C
extern uint64 sys_trace(void);
```
然后因为我们需要输出系统调用的名称，所以相应的，我们也得添加字符串数组。
```C
// string for output
static char *syscall_names[] = {
[SYS_fork]    "fork",
[SYS_exit]    "exit",
[SYS_wait]    "wait",
[SYS_pipe]    "pipe",
[SYS_read]    "read",
[SYS_kill]    "kill",
[SYS_exec]    "exec",
[SYS_fstat]   "fstat",
[SYS_chdir]   "chdir",
[SYS_dup]     "dup",
[SYS_getpid]  "getpid",
[SYS_sbrk]    "sbrk",
[SYS_sleep]   "sleep",
[SYS_uptime]  "uptime",
[SYS_open]    "open",
[SYS_write]   "write",
[SYS_mknod]   "mknod",
[SYS_unlink]  "unlink",
[SYS_link]    "link",
[SYS_mkdir]   "mkdir",
[SYS_close]   "close",
[SYS_trace]   "trace", 
[SYS_sysinfo] "sysinfo",
};
```
然后我们需要稍微修改一下`syscall`函数。
```C
void
syscall(void)
{
  int num;
  struct proc *p = myproc();

  num = p->trapframe->a7;
  if(num > 0 && num < NELEM(syscalls) && syscalls[num]) {
    p->trapframe->a0 = syscalls[num]();
    
    // 输出检测到的每次调用
    if(p->mask & (1 << num)) {
      printf("%d: syscall %s -> %d\n", p->pid, syscall_names[num], p->trapframe->a0);
    }
  } else { // 输入了错误的系统调用号
    printf("%d %s: unknown sys call %d\n",
            p->pid, p->name, num);
    p->trapframe->a0 = -1;
  }
}
```
#### sysproc.c
添加一个新的系统调用。
```C
uint64 
sys_trace(void)
{
  int mask;
  
  // 从用户那里获取系统调用号（int）
  if(argint(0, &mask) < 0)
    return -1;

  struct proc *p = myproc();
  printf("trace pid: %d\n", p->pid);
  p->mask = mask;
  
  return 0;
}
```
#### proc.c
在`freeproc`函数中顺便清除`mask`。
```C
p->mask = 0;
```
在`fork`函数中也要复制一下`mask`。
```C
np->mask = p->mask;
```

#### 测试
现在你去测试后，应该能拿到和作业需求相同的结果了，如果没有的话，就需要你自己去排查问题了。

### 常见疑问
Q：嗯？为什么`trace`可以输出那么多行，不是只执行了一次吗？   
A：细节可以去看`user/trace.c`，主要是这样：
1. 修改进程的`mask`数值。
2. 执行`trace 32`之后的命令，比如我们这里的是`grep hello README`。   
之后每次`grep`程序在执行时，他每调用任何一个系统调用（如`read`），`syscall`检测到我们写了`mask`的数值，它就会输出，所以可能不止执行一次。

Q：那么为什么`mask`的数值可以保留？   
A：因为`exec()`并不会覆盖`mask`数值，可以去看看`kernel/exe.c`

Q：`NELEM`是干什么的？   
A：`defs.h`有定义，是一个宏，作用是：算出整个数组有多少元素。

Q：`extern`是什么意思   
A：`extern`用来声明一个变量或者函数是在其他文件中定义的，这样编译器就知道它的存在了，比如：
```C
extern uint64 sys_trace(void);
```
这就代表`sys_trace`函数在其他地方定义了，我们只是声明一下，让编译器知道它的存在，不然调用时可能就会报错。

Q：为什么除了`user.h`的，其他的`trace`都是接收`void`的？   
A：在用户态，我们调用系统调用时是这样写的：
```C
int trace(int mask);
```
而在内核态，系统调用的是这样：
```C
uint64 sys_trace(void);
```
虽然函数定义中没有参数，但是实际上参数是通过寄存器传递的。
还记得刚刚我们用的`argint`吗？`argint(0, &var)`，这个`0`的意思就是`a0`寄存器，我们要从`a0`寄存器提取出实际的参数，然后复制给`var`。

Q：`usys.pl`文件是什么呀？是汇编吗？不过看着也不像呀。    
A：首先，他不是汇编文件，是`perl`脚本。他的作用是生成`usys.S`，是个汇编文件，我们`make qemu`之后会生成，感兴趣的话可以自己去看看。我复制了一段里面的代码：
```sh
.global trace
trace:
li a7, SYS_trace
ecall
ret
```
这段代码的作用是：
1. 将系统调用号（这里是22）加载到`a7`寄存器。
2. 执行`ecall`指令，在用户态触发系统调用（之后会进入内核态，不过那又是更复杂的事情了...）。
3. 返回到用户态。

## sysinfo (moderate)
这个实验要做的差不多就是：获取当前空闲的内存字节数，和所有没用到的进程的数量（因为XV6的进程数量是有上限的）

我们要修改的文件有这些：（之前做过的我就不说了，流程差不多）
```tree
kernel/
|-- kalloc.c
|-- proc.c
|-- sysproc.c
```

#### kalloc.c
```C
uint64
get_freemem(void)
{ 
  uint64 pages = 0;
  struct run *r;
  
  acquire(&kmem.lock);
  r = kmem.freelist;
  while(r){
    pages++;
    r = r->next;
  }
  release(&kmem.lock);

  return pages * PGSIZE; 
}
```
这代码的作用就是遍历所有空闲页，也可以说是`freelist`。
##### proc.c
```C
uint64
get_nproc(void)
{
  uint64 count = 0;
  struct proc *p;
  
  for(p = proc; p < &proc[NPROC]; p++){
    acquire(&p->lock);
    if(p->state != UNUSED){
      count++;
    }
    release(&p->lock);
  }
  return count;
}
```
这代码的作用就是遍历进程的列表，然后记录`UNUSED`进程的数量。
##### sysproc.c
```C
uint64
sys_sysinfo(void)
{
  uint64 param;
  if(argaddr(0, &param) < 0)
    return -1;

  struct sysinfo info;
  info.freemem = get_freemem();
  info.nproc = get_nproc();

  struct proc *p = myproc();
  if(copyout(p->pagetable, param, (char*)&info, sizeof(info)) < 0)
    return -1;

  return 0;
}
```
这段代码的作用是：
1. 获取地址。
2. 获取空闲内存字节数以及`UNUSED`进程数量。
3. 将其打包然后放进结构体。
4. 将结构体发送给用户。（使用`copyout`，感兴趣可以看看实现，不是很容易看，不过下一个lab你也得看就是了）

### 常见疑问
Q：`sysinfo`结构体是？    
A：xv6给我们做的，就是专门放这两个数据的，毕竟你想想，如果你只能发送一个文件，你要怎么发两个文件呢？没错，就是用结构体。

最后编辑时间：2025/6/12
