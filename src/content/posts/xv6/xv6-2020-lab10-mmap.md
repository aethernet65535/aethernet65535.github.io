---
title: XV6-2020: LAB10-MMAP
published: 2025-08-26
description: "这个比Linux的mmap简单多了"
image: "./lab10.jpg"
tags: ["xv6"]
category: OS
draft: false
---

# 前言
什么是`mmap()`呢？它为什么比传统的 read()/write() 更方便呢？        

好，现在用户要打开一个PDF文件，用户想要读书了，但是书差不多有2000页，他不想在今天读完。     
如果是`read()`/`write()`，虽然可以通过分段读取避免内存浪费，但需要程序员手动维护文件偏移量和缓冲区，实现起来比较繁琐。      

而`mmap()`提供了更优雅的解决方案，它通过内存映射的方式，将文件内容直接映射到进程的虚拟地址空间（VMA分区）。      
当用户昨天读到第255页，今天重新打开时，
系统通过按需加载机制，
只会将实际访问的第255页附近的数据加载到物理内存中，而不是整个文件。    

这种机制特别适合随机访问的场景。        
用户可能跳跃式地阅读不同章节，mmap()的缺页中断机制会自动处理数据的加载和缓存，无需人工干预。      

# 作业要求
我们要实现的`mmap()`接口如下：      
```C
void *mmap(void *addr, size_t length, int prot, int flags,int fd, off_t offset);
```
我来说说一下这些参数：
- `addr`：就是用户希望自己的文件被映射到什么位置（地址），测试文件只会使用0，读者们可以只处理0的情况，也就是自动分配地址
> 我的方案比较不一样，是这样的：
> - 0：自动分配
> - !0且合法：尝试映射指定地址
> - !0但已占用：返回错误
> - 非法：返回错误        
>
> 这里对非法的定义是，不在VMA范围内的，或是没对齐。

- `length`：用户希望能访问多少字节数，可以与真实文件大小不一致，但是系统会自动向上对齐

- `prot`：就是对文件的权限，有四种：
> - PROT_NONE：什么权限都没有，不知道干什么的，可能是占位用
> - PROT_READ：对文件可读，不过前提是文件本身就可读
> - PROT_WRITE：对文件可写，如果是SHARED，那么就根据文件自身权限判断，PRIVATE则无视
> - PROT_EXEC：可执行，不过xv6的testfile并没有这种东西，所以无视就行了

- `flags`：就是控制会不会影响源文件，有两种参数：
> - MAP_SHARED：对文件的修改会写回文件
> - MAP_PRIVATE：对文件的所有修改都不会写回文件

- `fd`：就是文件描述符，这个不细说了，我记得LAB-1就有教这个概念了

- `offset`：文件偏移量，就是说在你写入`addr[x]`时，`x`真正要写的地址得偏移多少字节数。
觉得难理解的话，就默认为0就行了，xv6的testfile也确实是这样用的

还有另一个，叫`munmap()`：
```C
int munmap(uint64 addr, int length)
```
- `addr`：地址必须对齐，可以填写中间地址，只要在对应VMA范围内即可
- `length`：多大都行，系统会处理，如果传入不对齐的，会自动向上对齐 

## 实现
### 定义VMA相关字段
`kernel/param.h`：
```C
/* ... */
#define NVMA 16 // maximum number of vma
```
第一个是每个进程最多能持有多少个VMA，说实话我没仔细算过会不会爆，不过相信MIT就行了，16页能有多大（虽然大概率会更大）。

`kernel/memlayout.h`：
```C
#define VMA_BASE 0x100000000
```
就是基地址，没算过，不过推测是大于堆，小于TRAPFRAME。

`kernel/proc.h`：
```C
struct vma{
  // 标志
  int used;
  int permission;
  int flags;
  
  // 地址
  uint64 start;
  uint64 end;
  int offset;

  // 文件
  struct file *file;
};
```
之后就是设置一些字段，这些都是必要的，所以都得设置。

```C
struct proc{
/* ... */
struct vma vma[NVMA]; // Virtual memory area
}
```
最后就是给每个进程都加一个VMA了，这样才能用。

### `mmap()`申请
`kernel/sysfile.c`：
```C
uint64
sys_mmap(void)
{
  uint64 addr;
  int prot, flags, length, offset;
  struct file *file;
  struct proc *p = myproc();
  struct vma *a = 0;

  // 参数获取
  if(argaddr(0, &addr) ||
     argint(1, &length) ||
     argint(2, &prot) ||
     argint(3, &flags) ||
     argfd(4, 0, &file) ||
     argint(5, &offset) < 0)
    return -1;

  // 错误检查
  if(addr != 0 && addr < VMA_BASE)
    return -1;
  if(addr != 0 && addr > TRAPFRAME)
    return -1;
  if(addr != 0 && addr % PGSIZE != 0)
    return -1;
  if((flags & MAP_SHARED) && !file->writable && (prot & PROT_WRITE))
    return -1;
  if(!file->readable && (prot & PROT_READ))
    return -1;

  // 找到能用的VMA
  int i;
  for(i = 0; i < NVMA; i++){
    if(!p->vma[i].used){
      a = &p->vma[i];
      break;
    }
  }
  if(a == 0) return -1;

  // 看看用户是自定义了地址还是想要自动分配（0）
  // testfile全是0
  uint64 next_start = addr == 0 ? VMA_BASE : addr;
  uint64 next_end = PGROUNDUP(next_start + length);
  int autoaddr = (addr == 0);
 
  // 循环找空闲地址
  while(next_end < TRAPFRAME){
    int overlap = 0;
    for(i = 0; i < NVMA; i++){
      if(!(p->vma[i].used))
        continue;
      while(1){
        // 通过直接跑
        if(next_start < p->vma[i].start && next_end < p->vma[i].start)
          break;
        if(p->vma[i].end < next_start && p->vma[i].end < next_end)
          break;
        // 自定义的没通过就不帮了
        if(!autoaddr)
          return -1;

        // 没通过就慢慢来
        overlap = 1;
        next_start += PGSIZE;
        next_end = PGROUNDUP(next_start + length);
      }
    }
    // 整个循环都没有以此冲突才算是完全通过（起飞）
    if(!overlap)
      break;
  }

  // 防止覆盖TRAPFRAME
  if(next_end >= TRAPFRAME)
    return -1;

  // 初始化申请
  a->used = 1;
  a->start = next_start;
  a->end = PGROUNDUP(a->start + length);
  a->file = file;
  a->offset = offset;
  a->permission = prot;
  a->flags = flags;

  // 引用次数 + 1
  filedup(file);

  return a->start;
}
```
对，就是申请而已，只是预定了这个位置，还不会给你分配内存，和之前COW有点像。

### 缺页中断
`kernel/vm.c`：
```C
// 辅助函数
// 因为通用所以就写了
struct vma*
find_vma(uint64 addr, struct proc *p)
{
  int i;
  struct vma *v = 0;

  // 遍历进程VMA表然后返回对应的
  for(i = 0; i < NVMA; i++){
    if(p->vma[i].used && addr >= p->vma[i].start && addr < p->vma[i].end){
      return &p->vma[i];
    }
  }
  return v;
}

// 缺页中断处理
int
mmap_pgfault(uint64 stval, struct proc *p)
{
  struct vma *a = 0;
  char *pa;
  uint64 off;
  struct inode *ip;

  stval = PGROUNDDOWN(stval);

  // 找到该地址属于哪个VMA
  if((a = find_vma(stval, p)) == 0)
    return -1;

  // 分配内存
  if((pa = kalloc()) == 0)
    return -1;
  memset(pa, 0, PGSIZE);

  // 写入用户设定的权限
  int perm = PTE_U;
  if(a->permission & PROT_READ)
    perm |= PTE_R;
  if(a->permission & PROT_WRITE)
    perm  |= PTE_W;

  // 生成该页，让用户可访问
  if(mappages(p->pagetable, stval, PGSIZE, (uint64)pa, perm) != 0)
    return -1;

  off = stval - a->start + a->offset;
  ip = a->file->ip;

  // 读取文件，然后把数据发给新页
  // 你可能会好奇，如果数据小于PGSIZE会发生什么
  // 答案是，它不会填满新页
  // 你可以试试去读读readi()的实现
  ilock(ip);
  if(readi(ip, 0, (uint64)pa, off, PGSIZE) <= 0){
    iunlock(ip);
    return -1;
  }
  iunlock(ip);

  return 0;
}
```
这个函数不会多难，就是生成页->修改权限->填入数据而已，
个别函数不理解的话看看实现基本就能理解了。

不过读取并填入数据时，要先修改offset，也就是文件内部的偏移量。    
因为缺页地址可能是某个中间地址，所以我们就要offset也跑到中间，以此保证数据正确。

### 取消映射
`kernel/sysfile.c`：
```C
uint64
sys_munmap(void)
{
  uint64 addr;
  int length;

  if(argaddr(0, &addr) || argint(1, &length))
    return -1;

  return __munmap(addr, length);
}
```
基本就是个转接站而已，做的也就是收收参数。

```C
void
free_vma(struct vma *v)
{
  if(v->file) 
    fileclose(v->file);

  v->start = 0;
  v->end = 0;
  v->file = 0;
  v->flags = 0;
  v->offset = 0;
  v->permission = 0;
  v->used = 0;
}
```
写个小函数练练手。

`kernel/vm.c`
```C
int
__munmap(uint64 addr, int length)
{
  struct proc *p = myproc();
  struct vma *v = 0;
  uint64 unlen;

  // 不允许没有对齐的地址
  if(addr % PGSIZE != 0)
    return -1;

  // 自动向上对齐
  length = PGROUNDUP(length);

  if(addr + length < addr)
    return -1;

  if((v = find_vma(addr, p)) == 0)
    return -1;
  uint64 orilen = v->end - v->start;

  if(addr == v->start){                                 // 从开头到中间/结尾（难度：1颗星）
    if((unlen = munmap_start(p, v, addr, length)) == -1)
      return -1;
  }
  else if(addr + length == v->end){                     // 从中间到结尾（难度：1颗星）
    if((unlen = munmap_end(p, v, addr, length)) == -1)
      return -1;
  }
  else if(addr > v->start && addr + length < v->end){   // 从中间到中间（难度：6颗星）
    if((unlen = munmap_split(p, v, addr, length)) == -1)
      return -1;
  }
  else
    return -1;

  if(orilen == unlen)
    free_vma(v);

  return 0;
}
```
这是博主重构后的，一开始比较乱，不适合扩展，
不过其实只保留`munmap_start()`也能过测试，读者如果烂的话，
只做`munmap_start()`的实现也可以。

```C
int
munmap_start(struct proc *p, struct vma *v, uint64 addr, int length)
{
  uint64 orilen = v->end - v->start;

  uint64 unstart = addr;
  // 防止length过大而发生意外
  uint64 unlen = PGROUNDUP(length) < orilen ? PGROUNDUP(length) : orilen;

  // 重新设置字段
  // 以免发生预期之外的行为
  v->start = unstart + unlen;
  v->offset += unlen;

  // 取消映射
  if(munmap(p, v, unstart, unlen) != 0)
    return -1;

  return unlen;
}
```
对比其他的，这个简直太简单了。

```C
int
munmap(struct proc *p, struct vma *v, uint64 unstart, uint64 unlen)
{
  uint64 va;

  // 修改字段以确保文件正确写回
  uint64 start = v->start;
  uint64 offset = v->offset;

  for(int i = 0; i < unlen / PGSIZE; i++){
    va = unstart + (i*PGSIZE);
    if(pte_valid(p->pagetable, va)){
      if(pte_dirty(p->pagetable, va) && v->flags & MAP_SHARED)
        munmap_writeback(va, PGSIZE, start, offset, v);
      uvmunmap(p->pagetable, va, 1, 1);
    }
  }
  return 0;
}
```
这个就是循环释放页，如果是SHARED且肮脏（数据已更新）的话，那就写回。

```C
int
munmap_writeback(uint64 unstart, uint64 unlen, uint64 start, uint64 offset, struct vma *a)
{
  struct file *file = a->file;
  uint64 off = unstart - start + offset;
  struct inode *ip = file->ip;

  ilock(ip);
  uint size = ip->size;
  iunlock(ip);

  if(off >= size) return -1;

  // 和刚刚的length差不多，为了防止过大
  uint64 n = unlen < size - off ? unlen : size - off;

  int r, ret = 0;
  // 为了防止事务日志过大
  int max = ((MAXOPBLOCKS-1-1-2) / 2) * BSIZE;
  int i = 0;

  while(i < n){
    int n1 = n - i;
    if(n1 > max)
      n1 = max;

    begin_op();
    ilock(ip);
    // 写回原文件
    //（inode, 
    // source(1-user, !1-kernel), 
    // source_addr, 
    // offset, 
    // n(write how much)) 
    // 返回 = 成功写入的字节数
    r = writei(ip, 1, unstart, off + i, n1);
    iunlock(ip);
    end_op();

    // writei()出错了
    if(r != n1)
      break;
    i += r;
  }
  ret = i == n ? n : -1; // 出错了就返回错误

  return ret;
}
```
这个可能会有点那，不过其实就是循环然后把数据写回原文件而已，
而且每次都是PGSIZE，基本没有太大然后出错的可能性。

#### 番外
这几个有其中不少都用了博主挺多时间的，主要用在DEBUG。

`kernel/vm.c`：
```C
int
munmap_end(struct proc *p, struct vma *v, uint64 addr, uint64 length)
{
  uint64 unstart = addr;
  uint64 unlen = v->end - unstart;

  v->end = unstart;

  if(munmap(p, v, unstart, unlen) != 0)
    return -1;

  return unlen;
}
```
这个不难，就是改一下起始地址而已，甚至offset都不用改。

```C
struct vma*
unused_vma(uint64 addr, struct proc *p)
{
  struct vma *v = 0;

  for(int i = 0; i < NVMA; i++){
    if(p->vma[i].used == 0)
      return &p->vma[i];
  }
  return v;
}
```
找到对应进程的空闲VMA，挺有用的小函数。

```C
int
munmap_split(struct proc *p, struct vma *v, uint64 addr, uint64 length)
{
  struct vma *nv = 0;
  // 找到当前进程的空闲VMA
  // 因为要分裂了
  if((nv = unused_vma(addr, p)) == 0)
    return -1;

  uint64 unstart = addr;
  uint64 unlen = length;

  uint64 new_start = PGROUNDUP(unstart + unlen);

  // 初始化申请新VMA
  nv->start = new_start;
  nv->end = v->end;
  nv->file = v->file;
  nv->flags = v->flags;
  nv->offset = v->offset + (nv->start - v->start);
  nv->permission = v->permission;
  nv->used = 1;

  // 用旧VMA来解除映射，简单些
  if(munmap(p, v, unstart, unlen) != 0){
    free_vma(nv);
    return -1;
  }

  // 别忘了旧的也得改
  v->end = unstart;

  // 因为加了块新的VMA，所以得加一下文件引用次数
  filedup(v->file);

  return unlen;
}
```
这个是博主费时间最多的函数了，主要有两个原因：
- 数学不行，不会算offset
- debug经验不够

博主稍微说说这个新的unmap方式是怎么样的。   
用户传的是中间地址，而且加上length后依旧够不到结束地址。    
在这种情况下，就需要在单VMA内部产生空洞，不过这样也会使VMA分裂。    
所以我们就需要做三件事情：
- 解除映射
- 申请新VMA
- 重新设置旧VMA的结束地址

### 小修小补
`kernel/proc.c`：
```C
void
exit(int status)
{
/* ... */

  // 写入所有共享脏页
  // 关闭所有VMA
  for(int i = 0; i < NVMA; i++){
    if(p->vma[i].used){
      int length = p->vma[i].end - p->vma[i].start;
      __munmap(p->vma[i].start, length);
      p->vma[i].used = 0;
    }
  }

/* ... */
}
```
在退出进程时，把做过的修改都写回去。

```C
void
fork_mmap(struct proc *np, struct proc *p)
{
  for(int i = 0; i < NVMA; i++){
    if(p->vma[i].used){
      np->vma[i] = p->vma[i];
      filedup(np->vma[i].file);
    }
  }
}

int
fork(void)
{
/* ... */

  safestrcpy(np->name, p->name, sizeof(p->name));

  fork_mmap(np, p);

  pid = np->pid;

  np->state = RUNNABLE;

/* ... */
}
```
测试中其中一个就是`fork()`相关的，所以这个是绝对有必要的。    
这个也不难，就是把已申请的全都复制到子进程。    
还有读者别忘了增加文件引用次数。

`kernel/sysproc.c`：
```C
uint64
sys_sbrk(void)
{
  int addr;
  int n;

  if(argint(0, &n) < 0)
    return -1;

  addr = myproc()->sz;

  // 防止堆空间覆盖VMA分区
  if(addr + n >= VMA_BASE)
    return -1;

  if(growproc(n) < 0)
    return -1;
  return addr;
}
```
可以说几乎没用，纯纯是楼主闲的蛋疼加的，读者们不加也可以。

# 完结撒花（〃｀ 3′〃）
这个花了博主不少时间，不过收获也真不少，博主现在觉得自己牛逼上天了。    
博主在做这个小作业时，还自己写了TESTFILE。    
只不过原本的TESTFILE存在一些问题，博主没发现。    
DEBUG了至少3小时才意识到不是自己实现的问题。

希望读者们的收获可以比博主还多更多更多，拜拜！q(≧▽≦q)

最后编辑时间：2025/8/30
